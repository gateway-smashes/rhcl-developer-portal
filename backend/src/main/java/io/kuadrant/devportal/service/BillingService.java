package io.kuadrant.devportal.service;

import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import io.kuadrant.devportal.domain.ApplicationPlan;
import io.kuadrant.devportal.domain.Enums.PaymentKind;
import io.kuadrant.devportal.domain.Enums.PaymentStatus;
import io.kuadrant.devportal.domain.Enums.SubscriptionStatus;
import io.kuadrant.devportal.domain.Payment;
import io.kuadrant.devportal.domain.PaymentMethod;
import io.kuadrant.devportal.domain.PortalUser;
import io.kuadrant.devportal.domain.Subscription;
import io.kuadrant.devportal.service.NmiClient.NmiResult;
import io.kuadrant.devportal.service.NmiClient.NmiVaultResult;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;

/**
 * Billing orchestration: charges a paid plan through {@link NmiClient}, records
 * every attempt as a {@link Payment} ledger line, and — on approval — activates
 * the subscription via {@link SubscriptionService#activateAfterPayment}. Also
 * manages the saved card (NMI Customer Vault) used for recurring charges.
 */
@ApplicationScoped
public class BillingService {

    private static final Logger LOG = Logger.getLogger(BillingService.class);

    @Inject
    NmiClient nmi;

    @Inject
    SubscriptionService subscriptions;

    @Inject
    AuditService audit;

    @ConfigProperty(name = "portal.billing.currency", defaultValue = "USD")
    String defaultCurrency;

    /**
     * Charge the plan price for {@code subscriptionId} with a Collect.js token.
     * On approval the subscription is activated and its one-time key is stashed
     * for {@link SubscriptionService#consumeLastCredential()} to return.
     */
    @Transactional
    public Payment payForSubscription(PortalUser user, Long subscriptionId, String paymentToken, boolean saveCard,
            String cardLast4, String cardBrand) {
        Subscription sub = ownedSubscription(user, subscriptionId);
        ApplicationPlan plan = ApplicationPlan.findById(sub.applicationPlanId);
        if (plan == null) {
            throw new NotFoundException("Plan not found: " + sub.applicationPlanId);
        }
        if (!plan.isPaid()) {
            throw new BadRequestException("Plan '" + plan.name + "' is free — no payment required");
        }
        if (sub.status == SubscriptionStatus.APPROVED) {
            throw new BadRequestException("Subscription is already active");
        }
        if (sub.status != SubscriptionStatus.PENDING) {
            throw new BadRequestException("Subscription is not payable in status " + sub.status);
        }

        if (saveCard) {
            saveToVault(user, paymentToken, cardLast4, cardBrand, null, null);
        }

        Payment pay = newPayment(user, sub, plan, PaymentKind.SUBSCRIPTION, cardLast4, cardBrand);
        NmiResult r = nmi.sale(plan.priceCents, paymentToken);
        stamp(pay, r);

        if (pay.status == PaymentStatus.APPROVED) {
            subscriptions.activateAfterPayment(sub.id, "system(payment #" + pay.id + ")");
            audit.record("billing.charged", user.username, "subscription", String.valueOf(sub.id),
                    "amount=" + money(plan) + " txn=" + pay.gatewayTransactionId);
        } else {
            audit.record("billing.declined", user.username, "subscription", String.valueOf(sub.id),
                    pay.gatewayMessage);
            LOG.infof("charge declined for subscription %d: %s", sub.id, pay.gatewayMessage);
        }
        return pay;
    }

    /** Recurring charge of the subscription's plan against the saved card. */
    @Transactional
    public Payment renew(PortalUser user, Long subscriptionId) {
        Subscription sub = ownedSubscription(user, subscriptionId);
        ApplicationPlan plan = ApplicationPlan.findById(sub.applicationPlanId);
        if (plan == null || !plan.isPaid()) {
            throw new BadRequestException("Not a paid subscription");
        }
        PaymentMethod method = PaymentMethod.defaultForUser(user.id);
        if (method == null) {
            throw new BadRequestException("No saved card — add one before a recurring charge");
        }
        Payment pay = newPayment(user, sub, plan, PaymentKind.RECURRING, method.cardLast4, method.cardBrand);
        NmiResult r = nmi.saleWithVault(plan.priceCents, method.vaultId);
        stamp(pay, r);
        audit.record(pay.status == PaymentStatus.APPROVED ? "billing.renewed" : "billing.declined",
                user.username, "subscription", String.valueOf(sub.id), pay.gatewayMessage);
        return pay;
    }

    @Transactional
    public PaymentMethod saveCard(PortalUser user, String paymentToken, String last4, String brand, String expMonth,
            String expYear) {
        return saveToVault(user, paymentToken, last4, brand, expMonth, expYear);
    }

    @Transactional
    public void removeCard(PortalUser user, Long id) {
        PaymentMethod m = PaymentMethod.findById(id);
        if (m == null || !m.userId.equals(user.id)) {
            throw new NotFoundException("Card not found: " + id);
        }
        m.delete();
    }

    private PaymentMethod saveToVault(PortalUser user, String token, String last4, String brand, String expMonth,
            String expYear) {
        NmiVaultResult v = nmi.addToVault(token);
        if (!v.success()) {
            throw new BadRequestException("Could not save card: " + v.responseText());
        }
        // Keep a single default card per user — demote any previous one.
        PaymentMethod existing = PaymentMethod.defaultForUser(user.id);
        if (existing != null) {
            existing.isDefault = false;
            existing.persist();
        }
        PaymentMethod m = new PaymentMethod();
        m.userId = user.id;
        m.vaultId = v.vaultId();
        m.cardLast4 = last4;
        m.cardBrand = brand;
        m.expMonth = expMonth;
        m.expYear = expYear;
        m.isDefault = true;
        m.persist();
        audit.record("billing.card_saved", user.username, "payment-method", String.valueOf(m.id),
                "last4=" + last4);
        return m;
    }

    private static Subscription ownedSubscription(PortalUser user, Long id) {
        Subscription sub = Subscription.findById(id);
        if (sub == null || !sub.userId.equals(user.id)) {
            throw new NotFoundException("Subscription not found: " + id);
        }
        return sub;
    }

    private Payment newPayment(PortalUser user, Subscription sub, ApplicationPlan plan, PaymentKind kind,
            String last4, String brand) {
        Payment p = new Payment();
        p.userId = user.id;
        p.subscriptionId = sub.id;
        p.applicationPlanId = plan.id;
        p.amountCents = plan.priceCents;
        p.currency = plan.currency != null ? plan.currency : defaultCurrency;
        p.kind = kind;
        p.cardLast4 = last4;
        p.cardBrand = brand;
        p.status = PaymentStatus.PENDING;
        p.persist();
        return p;
    }

    private static void stamp(Payment pay, NmiResult r) {
        pay.status = r.approved() ? PaymentStatus.APPROVED
                : r.declined() ? PaymentStatus.DECLINED : PaymentStatus.ERROR;
        pay.gatewayTransactionId = r.transactionId();
        pay.gatewayAuthCode = r.authCode();
        pay.gatewayMessage = r.responseText();
        pay.persist();
    }

    private static String money(ApplicationPlan plan) {
        return plan.currency + " " + (plan.priceCents / 100) + "." + String.format("%02d", plan.priceCents % 100);
    }
}
