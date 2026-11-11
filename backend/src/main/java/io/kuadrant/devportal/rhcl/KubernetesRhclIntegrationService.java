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
            return emptyUsage();
        }
        // Per-API (APIProduct) traffic from the Istio gateway. Per-consumer
        // attribution would need a consumer-id metric label, which the gateway
        // does not emit by default — documented in ARCHITECTURE.md.
        ApiProduct product = ApiProduct.findById(subscription.apiProductId);
        String workload = product != null ? product.name : "";
        if (workload.isBlank()) {
            return emptyUsage();
        }
        // Reporter: prefer `destination` (request-side sidecar emits with the
        // workload's own perspective) but fall back to `source` since most
        // backends in the lab don't run an Istio sidecar — only the gateway
        // does, and it reports as `source`. The regex matches whichever is
        // present so the dashboard works regardless of mesh topology.
        //
        // Per-consumer filter: the AuthPolicy injects `x-consumer-id` whose
        // value is the API-key Secret name (e.g. `apikey-banking-api-alice-3`),
        // and the req041 Telemetry CR projects that header into the
        // `request_headers_x_consumer_id` Prometheus label. With both in place
        // analytics show only THIS subscription's traffic.
        // The filter is strict — without the Telemetry CR the label is absent
        // and this query returns zero. That's a visible-failure-mode on purpose
        // (better than silently aggregating every consumer's traffic into the
        // logged-in user's dashboard). Install req041 / the grafana role to
        // populate the label.
        String keyName = nameFromRef(subscription.rhclApiKeyRef);
        String consumerId = keyName == null ? "" : "apikey-" + keyName;
        String selector = "destination_workload=~\"" + workload + ".*\""
                + ",reporter=~\"source|destination\""
                + (consumerId.isBlank() ? "" : ",request_headers_x_consumer_id=\"" + consumerId + "\"");

        long total = 0, success = 0, blocked = 0, e4 = 0, e5 = 0;
        var series = new java.util.ArrayList<UsageSummary.Point>();
        for (PrometheusClient.Bucket b : prometheus.rangeByResponseCode(selector, query.from(), query.to(), query.stepSeconds())) {
            long req = 0, ok = 0, blk = 0;
            for (var e : b.byCode().entrySet()) {
                long n = Math.round(e.getValue());
                req += n;
                String code = e.getKey();
                if (code.equals("429")) {
                    blk += n;
                    blocked += n;
                } else if (code.startsWith("2") || code.startsWith("3")) {
                    ok += n;
                    success += n;
                } else if (code.startsWith("4")) {
                    e4 += n;
                } else if (code.startsWith("5")) {
                    e5 += n;
                }
            }
            total += req;
            series.add(new UsageSummary.Point(b.timestamp(), req, ok, blk));
        }

        double latency = prometheus.queryScalar(
                "sum(rate(istio_request_duration_milliseconds_sum{" + selector + "}[5m]))"
                        + "/sum(rate(istio_request_duration_milliseconds_count{" + selector + "}[5m]))");
        if (Double.isNaN(latency)) {
            latency = 0.0;
        }

        ApplicationPlan plan = ApplicationPlan.findById(subscription.applicationPlanId);
        long quota = plan != null && plan.dailyQuota > 0 ? plan.dailyQuota : 0;
        long remaining = quota > 0 ? Math.max(0, quota - total) : 0;
        double pct = quota > 0 ? Math.min(100.0, (total * 100.0) / quota) : 0.0;
        java.time.Instant reset = java.time.Instant.now().plusSeconds(86400).truncatedTo(java.time.temporal.ChronoUnit.DAYS);

        return new UsageSummary(total, success, blocked, e4, e5, latency, remaining, pct, reset, series);
    }

    private static UsageSummary emptyUsage() {
        return new UsageSummary(0, 0, 0, 0, 0, 0, 0, 0.0,
                java.time.Instant.now().plusSeconds(86400), java.util.List.of());
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
