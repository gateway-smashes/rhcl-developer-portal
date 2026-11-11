package io.kuadrant.devportal.rhcl;

import io.kuadrant.devportal.domain.ApplicationPlan;
import io.kuadrant.devportal.domain.Subscription;

/**
 * Abstraction over Red Hat Connectivity Link (RHCL / Kuadrant). All
 * cluster-facing behavior is isolated behind this interface so the rest of the
 * portal never talks to Kubernetes directly (spec §7).
 *
 * <p>Two implementations exist:
 * <ul>
 *   <li>{@code MockRhclIntegrationService} — default; generates keys/usage
 *       locally. Used for development and the skeleton walkthrough.</li>
 *   <li>{@code KubernetesRhclIntegrationService} — drives the real CRDs
 *       ({@code APIProduct}, {@code APIKey}) and the Authorino-managed API-key
 *       {@code Secret} (whose {@code managed-by=authorino} label is the
 *       activation gate), and reads usage from Prometheus. Selected with
 *       {@code portal.rhcl.mode=kubernetes}.</li>
 * </ul>
 */
public interface RhclIntegrationService {

    /**
     * Provision (or fetch) the API key for an approved subscription. Returns
     * the credential including the plaintext key, which is shown to the user
     * exactly once.
     */
    ApiCredential provisionApiKey(Subscription subscription);

    /** Revoke the API key for a subscription (deletes/disables the Secret). */
    void revokeApiKey(Subscription subscription);

    /** Rotate the API key, returning the new plaintext value. */
    ApiCredential rotateApiKey(Subscription subscription);

    /** Apply/realign the plan (rate limits, quota) for a subscription. */
    void applyPlan(Subscription subscription, ApplicationPlan plan);

    /** Read consumption metrics for a subscription over the given window. */
    UsageSummary getUsage(Subscription subscription, UsageQuery query);

    /** Human-readable description of the active backend (for /health & UI). */
    String describe();
}
