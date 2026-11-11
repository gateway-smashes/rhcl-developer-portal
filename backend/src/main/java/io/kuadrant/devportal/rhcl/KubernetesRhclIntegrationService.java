package io.kuadrant.devportal.rhcl;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

import org.jboss.logging.Logger;

import io.kuadrant.devportal.domain.ApiProduct;
import io.kuadrant.devportal.domain.ApplicationPlan;
import io.kuadrant.devportal.domain.PortalUser;
import io.kuadrant.devportal.domain.Subscription;

import io.fabric8.kubernetes.api.model.GenericKubernetesResource;
import io.fabric8.kubernetes.api.model.ObjectMetaBuilder;
import io.fabric8.kubernetes.api.model.Secret;
import io.fabric8.kubernetes.api.model.SecretBuilder;
import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.dsl.base.ResourceDefinitionContext;
import io.quarkus.arc.lookup.LookupIfProperty;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/**
 * Real RHCL/Kuadrant integration. Drives the DevPortal CRDs
 * ({@code devportal.kuadrant.io/v1alpha1}: APIProduct, APIKey) and the
 * Authorino-managed API-key {@code Secret}. Active when
 * {@code portal.rhcl.mode=kubernetes}.
 *
 * <p>Activation gate: Authorino authenticates requests by selecting Secrets
 * labelled {@code app=<apiKeyAppLabel>} and
 * {@code authorino.kuadrant.io/managed-by=authorino} — creating that labelled
 * Secret is what activates a key (there is no {@code APIKeyRequest}/
 * {@code APIKeyApproval} CR flow; approval happens in the portal DB). The plan
 * tier and user id ride as annotations ({@code secret.kuadrant.io/plan-id},
 * {@code secret.kuadrant.io/user-id}); the PlanPolicy predicates match on
 * those. We create that Secret with the generated key so the gateway accepts
 * the consumer's test calls immediately. The {@code APIKey} CR we also write is
 * a non-reconciled record for traceability.
 */
@LookupIfProperty(name = "portal.rhcl.mode", stringValue = "kubernetes")
@ApplicationScoped
public class KubernetesRhclIntegrationService implements RhclIntegrationService {

    private static final Logger LOG = Logger.getLogger(KubernetesRhclIntegrationService.class);
    private static final String GROUP = "devportal.kuadrant.io";
    private static final String VERSION = "v1alpha1";

    @Inject
    KubernetesClient client;

    @Inject
    PortalConfig config;

    @Inject
    SettingsService settings;

    @Inject
    PrometheusClient prometheus;

    private static final ResourceDefinitionContext API_KEY = new ResourceDefinitionContext.Builder()
            .withGroup(GROUP).withVersion(VERSION).withKind("APIKey").withPlural("apikeys").withNamespaced(true).build();
    private static final ResourceDefinitionContext API_PRODUCT = new ResourceDefinitionContext.Builder()
            .withGroup(GROUP).withVersion(VERSION).withKind("APIProduct").withPlural("apiproducts").withNamespaced(true).build();

    @Override
    public ApiCredential provisionApiKey(Subscription subscription) {
        ApiProduct product = ApiProduct.findById(subscription.apiProductId);
        ApplicationPlan plan = ApplicationPlan.findById(subscription.applicationPlanId);
        PortalUser user = PortalUser.findById(subscription.userId);
        String ns = settings.rhclNamespace();
        String apiName = product != null ? product.name : "api";
        String userId = user != null ? user.username : ("user-" + subscription.userId);
        String resourceName = sanitize(apiName + "-" + userId + "-" + subscription.id);
        String secretName = "apikey-" + resourceName;

        String plain = ApiKeys.generate();

        // 1) Authorino-managed Secret holding the actual key value.
        Secret secret = new SecretBuilder()
                .withMetadata(new ObjectMetaBuilder()
                        .withName(secretName)
                        .withNamespace(ns)
                        .addToLabels("app", config.apiKeyAppLabel())
                        .addToLabels("authorino.kuadrant.io/managed-by", "authorino")
                        .addToLabels("app.kubernetes.io/managed-by", "developer-portal")
                        .addToAnnotations("secret.kuadrant.io/plan-id", plan != null ? plan.tier : "bronze")
                        .addToAnnotations("secret.kuadrant.io/user-id", userId)
                        .build())
                .withType("Opaque")
                .addToStringData("api_key", plain)
                .build();
        client.secrets().inNamespace(ns).resource(secret).serverSideApply();

        // 2) APIKey CR linking product/plan/secret (devportal model).
        // `secretRef` was added in Kuadrant 1.4's CRD; the 1.3 schema rejects
        // it as an unknown field. Only include when explicitly enabled.
        Map<String, Object> apiKeySpec = new java.util.LinkedHashMap<>();
        apiKeySpec.put("apiProductRef", Map.of("name", apiName));
        apiKeySpec.put("planTier", plan != null ? plan.tier : "bronze");
        apiKeySpec.put("requestedBy", Map.of("email", user != null ? user.email : "", "userId", userId));
        if (settings.apiKeyEmitSecretRef()) {
            apiKeySpec.put("secretRef", Map.of("name", secretName));
        }
        apiKeySpec.put("useCase", subscription.useCase != null ? subscription.useCase : "Provisioned by developer portal");
        GenericKubernetesResource apiKey = devPortalResource("APIKey", "apikeys", resourceName, ns, apiKeySpec);
        client.genericKubernetesResources(API_KEY).inNamespace(ns).resource(apiKey).serverSideApply();

        subscription.rhclApiKeyRef = ns + "/" + resourceName;
        String hostname = resolveHostname(product, ns, apiName);
        LOG.infof("[k8s] provisioned APIKey %s + Secret %s for subscription %d", resourceName, secretName, subscription.id);
        return new ApiCredential(resourceName, plain, ApiKeys.mask(plain),
                config.apiKeyHeader(), hostname, ns + "/" + secretName);
    }

    @Override
    public void revokeApiKey(Subscription subscription) {
        String ns = settings.rhclNamespace();
        String name = nameFromRef(subscription.rhclApiKeyRef);
        if (name == null) {
            return;
        }
        client.genericKubernetesResources(API_KEY).inNamespace(ns).withName(name).delete();
        client.secrets().inNamespace(ns).withName("apikey-" + name).delete();
        LOG.infof("[k8s] revoked APIKey %s for subscription %d", name, subscription.id);
    }

    @Override
    public ApiCredential rotateApiKey(Subscription subscription) {
        revokeApiKey(subscription);
        return provisionApiKey(subscription);
    }

    @Override
    public void applyPlan(Subscription subscription, ApplicationPlan plan) {
        // Plan enforcement is owned by the PlanPolicy on the cluster; here we
        // only realign the plan-id annotation on the key Secret.
        String ns = settings.rhclNamespace();
        String name = nameFromRef(subscription.rhclApiKeyRef);
        if (name == null) {
            return;
        }
        client.secrets().inNamespace(ns).withName("apikey-" + name).edit(s -> new SecretBuilder(s)
                .editMetadata().addToAnnotations("secret.kuadrant.io/plan-id", plan.tier).endMetadata().build());
        LOG.infof("[k8s] applied plan tier %s to subscription %d", plan.tier, subscription.id);
    }

    @Override
    public UsageSummary getUsage(Subscription subscription, UsageQuery query) {
        // Until portal.rhcl.prometheus-url is configured, return an empty-but-valid
        // summary so the dashboard renders a graceful empty state (spec §4.8/§10).
        if (!prometheus.enabled()) {
            return emptyUsage(UsageSummary.SOURCE_NONE);
        }
        ApiProduct product = ApiProduct.findById(subscription.apiProductId);
        String workload = product != null ? product.name : "";
        if (workload.isBlank()) {
            return emptyUsage(UsageSummary.SOURCE_NONE);
        }
        // Per-API (APIProduct) traffic from the Istio gateway. `reporter`
        // matches whichever sidecar is present (source|destination) so the
        // dashboard works regardless of mesh topology.
        String apiSelector = "destination_workload=~\"" + workload + ".*\",reporter=~\"source|destination\"";

        // Per-consumer attribution: RHCL 1.5's TelemetryPolicy
        // (deploy/telemetry-policy.yaml) projects the authenticated consumer
        // identity into a metric label (config.consumerMetricLabel(), default
        // `consumer`) whose value is the API-key Secret name. Prefer that so
        // analytics show only THIS subscription's traffic.
        //
        // If the projection isn't installed the label is absent and the query
        // yields no series. Rather than silently reporting zero (the old
        // `request_headers_x_consumer_id` istio hack did exactly that), we fall
        // back to per-API totals and flag the result as `unattributed` so the
        // UI can say the numbers cover all consumers, not just this key.
        String keyName = nameFromRef(subscription.rhclApiKeyRef);
        String consumerValue = keyName == null ? "" : "apikey-" + keyName;

        Agg agg;
        String selector;
        String source;
        if (consumerValue.isBlank()) {
            // No key ref to attribute by — per-API totals at best.
            selector = apiSelector;
            agg = aggregate(apiSelector, query);
            source = agg.total > 0 ? UsageSummary.SOURCE_UNATTRIBUTED : UsageSummary.SOURCE_NONE;
        } else {
            String consumerSelector = apiSelector + "," + config.consumerMetricLabel() + "=\"" + consumerValue + "\"";
            agg = aggregate(consumerSelector, query);
            if (agg.total > 0) {
                selector = consumerSelector;
                source = UsageSummary.SOURCE_PER_CONSUMER;
            } else {
                Agg apiAgg = aggregate(apiSelector, query);
                if (apiAgg.total > 0) {
                    agg = apiAgg;
                    selector = apiSelector;
                    source = UsageSummary.SOURCE_UNATTRIBUTED;
                } else {
                    selector = consumerSelector;
                    source = UsageSummary.SOURCE_NONE;
                }
            }
        }

        double latency = prometheus.queryScalar(
                "sum(rate(istio_request_duration_milliseconds_sum{" + selector + "}[5m]))"
                        + "/sum(rate(istio_request_duration_milliseconds_count{" + selector + "}[5m]))");
        if (Double.isNaN(latency)) {
            latency = 0.0;
        }

        ApplicationPlan plan = ApplicationPlan.findById(subscription.applicationPlanId);
        long quota = plan != null && plan.dailyQuota > 0 ? plan.dailyQuota : 0;
        long remaining = quota > 0 ? Math.max(0, quota - agg.total) : 0;
        double pct = quota > 0 ? Math.min(100.0, (agg.total * 100.0) / quota) : 0.0;
        java.time.Instant reset = java.time.Instant.now().plusSeconds(86400).truncatedTo(java.time.temporal.ChronoUnit.DAYS);

        return new UsageSummary(agg.total, agg.success, agg.blocked, agg.e4, agg.e5, latency,
                remaining, pct, reset, agg.series, source);
    }

    /** Summed response-code counters + a time series from a query_range. */
    private Agg aggregate(String selector, UsageQuery query) {
        Agg a = new Agg();
        for (PrometheusClient.Bucket b : prometheus.rangeByResponseCode(selector, query.from(), query.to(), query.stepSeconds())) {
            long req = 0, ok = 0, blk = 0;
            for (var e : b.byCode().entrySet()) {
                long n = Math.round(e.getValue());
                req += n;
                String code = e.getKey();
                if (code.equals("429")) {
                    blk += n;
                    a.blocked += n;
                } else if (code.startsWith("2") || code.startsWith("3")) {
                    ok += n;
                    a.success += n;
                } else if (code.startsWith("4")) {
                    a.e4 += n;
                } else if (code.startsWith("5")) {
                    a.e5 += n;
                }
            }
            a.total += req;
            a.series.add(new UsageSummary.Point(b.timestamp(), req, ok, blk));
        }
        return a;
    }

    private static final class Agg {
        long total, success, blocked, e4, e5;
        final java.util.List<UsageSummary.Point> series = new java.util.ArrayList<>();
    }

    private static UsageSummary emptyUsage(String source) {
        return new UsageSummary(0, 0, 0, 0, 0, 0, 0, 0.0,
                java.time.Instant.now().plusSeconds(86400), java.util.List.of(), source);
    }

    @Override
    public String describe() {
        return "kubernetes (RHCL CRDs in ns " + settings.rhclNamespace() + ")";
    }

    private GenericKubernetesResource devPortalResource(String kind, String plural, String name, String ns,
            Map<String, Object> spec) {
        GenericKubernetesResource r = new GenericKubernetesResource();
        r.setApiVersion(GROUP + "/" + VERSION);
        r.setKind(kind);
        r.setMetadata(new ObjectMetaBuilder().withName(name).withNamespace(ns)
                .addToLabels("app.kubernetes.io/managed-by", "developer-portal").build());
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("spec", spec);
        r.setAdditionalProperties(props);
        return r;
    }

    @SuppressWarnings("unchecked")
    private String resolveHostname(ApiProduct product, String ns, String apiName) {
        try {
            GenericKubernetesResource cr = client.genericKubernetesResources(API_PRODUCT)
                    .inNamespace(ns).withName(apiName).get();
            if (cr != null) {
                Map<String, Object> status = (Map<String, Object>) cr.getAdditionalProperties().get("status");
                // APIKey status carries apiHostname; APIProduct exposes oidcDiscovery etc.
                if (status != null && status.get("apiHostname") instanceof String h) {
                    return h;
                }
            }
        } catch (RuntimeException e) {
            LOG.debugf("could not resolve hostname from APIProduct %s: %s", apiName, e.getMessage());
        }
        if (product != null && product.baseUrl != null) {
            return product.baseUrl.replaceFirst("^https?://", "").replaceAll("/.*$", "");
        }
        return config.defaultHostname().orElse("");
    }

    private static String nameFromRef(String ref) {
        if (ref == null || !ref.contains("/")) {
            return ref;
        }
        return ref.substring(ref.indexOf('/') + 1);
    }

    private static String sanitize(String s) {
        return s.toLowerCase().replaceAll("[^a-z0-9-]", "-").replaceAll("-+", "-")
                .replaceAll("^-|-$", "");
    }

    static String decodeSecretValue(Secret secret, String key) {
        if (secret == null || secret.getData() == null || !secret.getData().containsKey(key)) {
            return null;
        }
        return new String(Base64.getDecoder().decode(secret.getData().get(key)), StandardCharsets.UTF_8);
    }
}
