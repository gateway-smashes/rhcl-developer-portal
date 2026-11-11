package io.kuadrant.devportal.rhcl;

import java.util.Optional;

import io.smallrye.config.ConfigMapping;
import io.smallrye.config.WithDefault;

/**
 * Configuration for the RHCL integration layer, bound from {@code portal.rhcl.*}.
 */
@ConfigMapping(prefix = "portal.rhcl")
public interface PortalConfig {

    /** {@code mock} (default) or {@code kubernetes}. */
    @WithDefault("mock")
    String mode();

    /** Namespace holding the RHCL DevPortal CRs and API-key Secrets. */
    @WithDefault("rhcl-apps")
    String namespace();

    /** Header the gateway expects the API key in. */
    @WithDefault("api-key")
    String apiKeyHeader();

    /** Authorino Secret label key/value that marks a managed API-key Secret. */
    @WithDefault("banking-api-apikey")
    String apiKeyAppLabel();

    /**
     * Prometheus metric label that carries the per-consumer identity, projected
     * by the RHCL 1.5 {@code TelemetryPolicy} (see {@code deploy/telemetry-policy.yaml}).
     * Usage is attributed to a subscription by matching this label against the
     * API-key Secret name. Must match the label the deployed TelemetryPolicy
     * projects. When the projection is absent the query returns no series and
     * the dashboard degrades to clearly-labelled per-API totals instead of a
     * silent zero.
     */
    @WithDefault("consumer")
    String consumerMetricLabel();

    /**
     * Whether to emit {@code spec.secretRef} on the {@code APIKey} CR.
     * Required by RHCL 1.4 (CRD v1alpha1 enforces it). Rejected by RHCL 1.3
     * (the field is not declared in the schema → API server returns 500
     * on patch). Defaults to {@code false} so a stock install against the
     * pinned 1.3.4 line works out of the box; flip to {@code true} when
     * the cluster runs Kuadrant 1.4+.
     */
    @WithDefault("false")
    boolean apiKeyEmitSecretRef();

    /** Fallback gateway hostname when an APIProduct has none in status. */
    Optional<String> defaultHostname();

    /** Base URL of the in-cluster Thanos/Prometheus query API (real usage). */
    Optional<String> prometheusUrl();

    /** File holding the bearer token used to query Thanos (SA token by default). */
    @WithDefault("/var/run/secrets/kubernetes.io/serviceaccount/token")
    String prometheusTokenPath();
}
