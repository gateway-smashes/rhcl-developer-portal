package io.kuadrant.devportal.api;

import org.eclipse.microprofile.config.inject.ConfigProperty;

import io.kuadrant.devportal.api.Dtos.ApiCredentialDto;
import io.kuadrant.devportal.api.Dtos.BillingConfigDto;
import io.kuadrant.devportal.api.Dtos.BillingStateDto;
import io.kuadrant.devportal.api.Dtos.ChargeRequest;
import io.kuadrant.devportal.api.Dtos.ChargeResultDto;
import io.kuadrant.devportal.api.Dtos.PaymentDto;
import io.kuadrant.devportal.api.Dtos.PaymentMethodDto;
import io.kuadrant.devportal.api.Dtos.SaveCardRequest;
import io.kuadrant.devportal.domain.Payment;
import io.kuadrant.devportal.domain.PaymentMethod;
import io.kuadrant.devportal.domain.PortalUser;
import io.kuadrant.devportal.security.CurrentUser;
import io.kuadrant.devportal.service.BillingService;
import io.kuadrant.devportal.service.SubscriptionService;

import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

/** Authenticated billing endpoints — pay for a plan, manage saved cards. */
@Path("/api/me/billing")
@Produces(MediaType.APPLICATION_JSON)
public class BillingResource {

    @Inject
    CurrentUser currentUser;

    @Inject
    BillingService billing;

    @Inject
    SubscriptionService subscriptions;

    @ConfigProperty(name = "portal.billing.enabled", defaultValue = "true")
    boolean enabled;

    @ConfigProperty(name = "portal.billing.mode", defaultValue = "mock")
    String mode;

    @ConfigProperty(name = "portal.billing.currency", defaultValue = "USD")
    String currency;

    // Optional: empty in mock mode (see NmiClient for why Optional, not String).
    @ConfigProperty(name = "portal.billing.nmi.tokenization-key")
    java.util.Optional<String> tokenizationKey;

    /** What the frontend needs to load Collect.js (public tokenization key). */
    @GET
    @Path("/config")
    public BillingConfigDto config() {
        return new BillingConfigDto(enabled, mode, currency,
                tokenizationKey.filter(s -> !s.isBlank()).orElse(""));
    }

    /** Saved cards + payment history for the current user. */
    @GET
    public BillingStateDto state() {
        PortalUser u = currentUser.get();
        var methods = PaymentMethod.listForUser(u.id).stream().map(PaymentMethodDto::of).toList();
        var payments = Payment.listForUser(u.id).stream().map(PaymentDto::of).toList();
        return new BillingStateDto(config(), methods, payments);
    }

    /**
     * Charge a subscription's plan price with a Collect.js token. When the
     * gateway approves, the subscription is activated and the one-time API key
     * is returned in {@code credential}.
     */
    @POST
    @Path("/charge")
    public ChargeResultDto charge(@Valid ChargeRequest req) {
        PortalUser u = currentUser.get();
        Payment pay = billing.payForSubscription(u, req.subscriptionId(), req.paymentToken(), req.saveCard(),
                req.cardLast4(), req.cardBrand());
        ApiCredentialDto cred = subscriptions.consumeLastCredential(); // non-null only when activated
        return new ChargeResultDto(PaymentDto.of(pay), cred);
    }

    /** Save a card to the NMI Customer Vault for later recurring charges. */
    @POST
    @Path("/methods")
    public PaymentMethodDto saveCard(@Valid SaveCardRequest req) {
        PortalUser u = currentUser.get();
        return PaymentMethodDto.of(billing.saveCard(u, req.paymentToken(), req.cardLast4(), req.cardBrand(),
                req.expMonth(), req.expYear()));
    }

    @DELETE
    @Path("/methods/{id}")
    public void removeCard(@PathParam("id") Long id) {
        billing.removeCard(currentUser.get(), id);
    }

    /** Run a recurring charge of the plan against the user's saved card. */
    @POST
    @Path("/subscriptions/{id}/renew")
    public ChargeResultDto renew(@PathParam("id") Long id) {
        PortalUser u = currentUser.get();
        Payment pay = billing.renew(u, id);
        return new ChargeResultDto(PaymentDto.of(pay), null);
    }
}
