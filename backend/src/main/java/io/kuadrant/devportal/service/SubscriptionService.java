package io.kuadrant.devportal.service;

import java.time.Instant;

import org.jboss.logging.Logger;

import io.kuadrant.devportal.api.Dtos.ApiCredentialDto;
import io.kuadrant.devportal.domain.ApiKey;
import io.kuadrant.devportal.domain.ApiProduct;
import io.kuadrant.devportal.domain.Application;
import io.kuadrant.devportal.domain.ApplicationPlan;
import io.kuadrant.devportal.domain.Enums.ApiKeyStatus;
import io.kuadrant.devportal.domain.Enums.ApprovalMode;
import io.kuadrant.devportal.domain.Enums.Environment;
import io.kuadrant.devportal.domain.Enums.SubscriptionStatus;
import io.kuadrant.devportal.domain.PortalUser;
import io.kuadrant.devportal.domain.Subscription;
import io.kuadrant.devportal.rhcl.ApiCredential;
import io.kuadrant.devportal.rhcl.RhclIntegrationService;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;

/**
 * Orchestrates the subscription lifecycle and the RHCL key provisioning that
 * hangs off it (spec §4.5, §4.6). All cluster interaction is delegated to the
 * {@link RhclIntegrationService} so this class stays free of Kubernetes types.
 */
@ApplicationScoped
public class SubscriptionService {

    private static final Logger LOG = Logger.getLogger(SubscriptionService.class);

    @Inject
    Instance<RhclIntegrationService> rhcl;

    @Inject
    AuditService audit;

    @Inject
    PortalMetrics metrics;

    private RhclIntegrationService integration() {
        return rhcl.get();
    }

    /** Create a subscription request. Auto-approves when the plan allows. */
    @Transactional
    public Subscription request(PortalUser user, Long apiProductId, Long applicationId, Long planId,
            String environment, String useCase) {
        ApiProduct product = ApiProduct.findById(apiProductId);
        if (product == null) {
            throw new NotFoundException("API product not found: " + apiProductId);
        }
        Application app = Application.findById(applicationId);
        if (app == null || !app.ownerUserId.equals(user.id)) {
            throw new BadRequestException("Application not found or not owned by user");
        }
        ApplicationPlan plan = ApplicationPlan.findById(planId);
        if (plan == null) {
            throw new NotFoundException("Plan not found: " + planId);
        }

        Subscription sub = new Subscription();
        sub.apiProductId = apiProductId;
        sub.applicationId = applicationId;
        sub.applicationPlanId = planId;
        sub.userId = user.id;
        sub.useCase = useCase;
        sub.environment = parseEnv(environment, app.environment);
        sub.status = SubscriptionStatus.PENDING;
        sub.persist();
        metrics.incSubscriptionsCreated();
        audit.record("subscription.created", user.username, "subscription", String.valueOf(sub.id),
                "product=" + product.name + " plan=" + plan.tier);

        // A paid plan never activates on creation — it waits for a successful
        // charge (see BillingService#payForSubscription → activateAfterPayment).
        boolean autoApprove = product.approvalMode == ApprovalMode.AUTOMATIC
                && !plan.approvalRequired && !plan.isPaid();
        if (autoApprove) {
            doApprove(sub, "system(auto)");
        }
        return sub;
    }

    /**
     * Activate a pending subscription once its plan has been paid for. Invoked
     * by {@link io.kuadrant.devportal.service.BillingService} after the gateway
     * approves the charge, on the same request thread — the freshly minted key
     * is stashed in {@link #LAST_PLAINTEXT} for the resource to return once via
     * {@link #consumeLastCredential()}, exactly like the admin-approval path.
     */
    @Transactional
    public void activateAfterPayment(Long subscriptionId, String reviewer) {
        Subscription sub = findOrThrow(subscriptionId);
        if (sub.status == SubscriptionStatus.APPROVED) {
            return; // already activated — treat a repeat charge as a renewal, not a re-key
        }
        if (sub.status != SubscriptionStatus.PENDING) {
            throw new BadRequestException("Subscription is not pending: " + sub.status);
        }
        doApprove(sub, reviewer);
    }

    /** Approve a pending subscription and provision its key. Admin/owner only. */
    @Transactional
    public Subscription approve(Long subscriptionId, String reviewer) {
        Subscription sub = findOrThrow(subscriptionId);
        if (sub.status != SubscriptionStatus.PENDING) {
            throw new BadRequestException("Subscription is not pending: " + sub.status);
        }
        doApprove(sub, reviewer);
        return sub;
    }

    private void doApprove(Subscription sub, String reviewer) {
        ApplicationPlan plan = ApplicationPlan.findById(sub.applicationPlanId);
        ApiCredential cred = integration().provisionApiKey(sub);
        integration().applyPlan(sub, plan);

        ApiKey key = new ApiKey();
        key.subscriptionId = sub.id;
        key.keyHash = io.kuadrant.devportal.rhcl.ApiKeys.hash(cred.plainKey());
        key.keyPreview = cred.keyPreview();
        key.secretRef = cred.secretRef();
        key.status = ApiKeyStatus.ACTIVE;
        key.persist();

        sub.status = SubscriptionStatus.APPROVED;
        sub.approvedAt = Instant.now();
        sub.reviewedBy = reviewer;
        // rhclApiKeyRef was set by the integration layer during provisioning.

        metrics.incApiKeysCreated();
        metrics.incSubscriptionApprovals();
        audit.record("subscription.approved", reviewer, "subscription", String.valueOf(sub.id), "keyPreview=" + cred.keyPreview());
        audit.record("apikey.created", reviewer, "apikey", String.valueOf(key.id), "secretRef=" + cred.secretRef());
        LOG.infof("approved subscription %d (reviewer=%s)", sub.id, reviewer);
        // Stash the plaintext for one-time return on the request thread.
        LAST_PLAINTEXT.set(cred);
    }

    @Transactional
    public Subscription reject(Long subscriptionId, String reviewer, String reason) {
        Subscription sub = findOrThrow(subscriptionId);
        sub.status = SubscriptionStatus.REJECTED;
        sub.reviewedBy = reviewer;
        sub.rejectionReason = reason;
        audit.record("subscription.rejected", reviewer, "subscription", String.valueOf(sub.id), reason);
        return sub;
    }

    @Transactional
    public Subscription suspend(Long subscriptionId, String reviewer) {
        Subscription sub = findOrThrow(subscriptionId);
        sub.status = SubscriptionStatus.SUSPENDED;
        sub.reviewedBy = reviewer;
        ApiKey key = ApiKey.findActiveForSubscription(sub.id);
        if (key != null) {
            integration().revokeApiKey(sub);
            key.status = ApiKeyStatus.REVOKED;
            key.revokedAt = Instant.now();
            metrics.incApiKeysRevoked();
        }
        audit.record("subscription.suspended", reviewer, "subscription", String.valueOf(sub.id), null);
        return sub;
    }

    /** Rotate the active key for a subscription owned by {@code user}. */
    @Transactional
    public ApiCredentialDto rotateKey(PortalUser user, Long subscriptionId) {
        Subscription sub = findOrThrow(subscriptionId);
        if (!sub.userId.equals(user.id)) {
            throw new io.kuadrant.devportal.api.PortalForbiddenException("Not your subscription");
        }
        if (sub.status != SubscriptionStatus.APPROVED) {
            throw new BadRequestException("Subscription is not approved");
        }
        ApiCredential cred = integration().rotateApiKey(sub);
        ApiKey key = ApiKey.findActiveForSubscription(sub.id);
        if (key == null) {
            key = new ApiKey();
            key.subscriptionId = sub.id;
            key.status = ApiKeyStatus.ACTIVE;
        }
        key.keyHash = io.kuadrant.devportal.rhcl.ApiKeys.hash(cred.plainKey());
        key.keyPreview = cred.keyPreview();
        key.secretRef = cred.secretRef();
        key.rotatedAt = Instant.now();
        key.persist();
        metrics.incApiKeysRotated();
        audit.record("apikey.rotated", user.username, "subscription", String.valueOf(sub.id), null);
        return toCredentialDto(cred);
    }

    /** Returns and clears the one-time plaintext captured during approval. */
    public ApiCredentialDto consumeLastCredential() {
        ApiCredential cred = LAST_PLAINTEXT.get();
        LAST_PLAINTEXT.remove();
        return cred == null ? null : toCredentialDto(cred);
    }

    public static ApiCredentialDto toCredentialDto(ApiCredential cred) {
        String curl = "curl -H \"" + cred.headerName() + ": " + cred.plainKey() + "\" https://"
                + cred.hostname() + "/api/v1/accounts/summary";
        return new ApiCredentialDto(cred.keyId(), cred.plainKey(), cred.keyPreview(), cred.headerName(),
                cred.hostname(), curl);
    }

    private static Subscription findOrThrow(Long id) {
        Subscription sub = Subscription.findById(id);
        if (sub == null) {
            throw new NotFoundException("Subscription not found: " + id);
        }
        return sub;
    }

    private static Environment parseEnv(String env, Environment fallback) {
        if (env == null || env.isBlank()) {
            return fallback;
        }
        try {
            return Environment.valueOf(env.toUpperCase());
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    // Carries the freshly-minted key across the approval call so the resource
    // can return it exactly once without persisting plaintext.
    private static final ThreadLocal<ApiCredential> LAST_PLAINTEXT = new ThreadLocal<>();
}
