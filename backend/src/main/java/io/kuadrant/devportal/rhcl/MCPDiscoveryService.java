package io.kuadrant.devportal.rhcl;

import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.jboss.logging.Logger;

import io.fabric8.kubernetes.api.model.GenericKubernetesResource;
import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.dsl.base.ResourceDefinitionContext;
import io.kuadrant.devportal.domain.ApiProduct;
import io.kuadrant.devportal.domain.Enums.ApiProtocol;
import io.kuadrant.devportal.domain.Enums.ApiStatus;
import io.kuadrant.devportal.domain.Enums.ApprovalMode;

import io.quarkus.arc.lookup.LookupIfProperty;
import io.quarkus.scheduler.Scheduled;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;

/**
 * Periodic reconciler that surfaces Kuadrant
 * {@code MCPServerRegistration} CRs as MCP-protocol entries in the portal
 * catalog. Same shape as the REST APIProduct sync: discover, upsert, mark
 * as {@code published} so the public catalogue picks them up.
 *
 * Runs only when the build profile is {@code prod} (i.e. the in-cluster
 * deployment); the dev profile uses the static seed in {@link
 * io.kuadrant.devportal.service.DataSeeder} so {@code quarkus:dev}
 * doesn't need a live cluster.
 */
@ApplicationScoped
@LookupIfProperty(name = "portal.rhcl.mode", stringValue = "kubernetes")
public class MCPDiscoveryService {

    private static final Logger LOG = Logger.getLogger(MCPDiscoveryService.class);

    private static final ResourceDefinitionContext MCP_SERVER_REGISTRATION =
            new ResourceDefinitionContext.Builder()
                    .withGroup("mcp.kuadrant.io")
                    .withVersion("v1")
                    .withPlural("mcpserverregistrations")
                    .withKind("MCPServerRegistration")
                    .withNamespaced(true)
                    .build();

    private static final ResourceDefinitionContext MCP_GATEWAY_EXTENSION =
            new ResourceDefinitionContext.Builder()
                    .withGroup("mcp.kuadrant.io")
                    .withVersion("v1")
                    .withPlural("mcpgatewayextensions")
                    .withKind("MCPGatewayExtension")
                    .withNamespaced(true)
                    .build();

    @Inject
    KubernetesClient client;

    @Inject
    PortalConfig config;

    /**
     * Cluster-wide poll every 60s. Cheap (one LIST per CR kind) and aligns
     * with how the upstream Kuadrant operators reconcile.
     */
    @Scheduled(every = "60s", delayed = "20s")
    @Transactional
    public void reconcile() {
        try {
            doReconcile();
        } catch (Exception e) {
            // CRDs not installed? swallow — clusters without the MCP gateway
            // shouldn't see startup noise. Real config errors surface in the
            // operator pods anyway.
            LOG.debugf("MCP reconcile skipped: %s", e.getMessage());
        }
    }

    private void doReconcile() {
        List<GenericKubernetesResource> registrations =
                client.genericKubernetesResources(MCP_SERVER_REGISTRATION).inAnyNamespace().list().getItems();
        if (registrations.isEmpty()) {
            return;
        }

        // Build a cheap (namespace -> publicHost) lookup. Multiple MCP
        // gateways are rare but supported — first match wins.
        Map<String, String> hostByNs = client.genericKubernetesResources(MCP_GATEWAY_EXTENSION)
                .inAnyNamespace().list().getItems().stream()
                .collect(java.util.stream.Collectors.toMap(
                        r -> r.getMetadata().getNamespace(),
                        r -> Objects.toString(spec(r).get("privateHost"), ""),
                        (a, b) -> a));

        for (GenericKubernetesResource r : registrations) {
            String ns = r.getMetadata().getNamespace();
            String name = r.getMetadata().getName();
            Map<String, Object> spec = spec(r);
            String prefix = Objects.toString(spec.get("prefix"), name);
            String path = Objects.toString(spec.get("path"), "/mcp");
            String host = hostByNs.getOrDefault(ns, "");
            String endpoint = host.isEmpty() ? path : ("https://" + host + path);

            String productName = "mcp-" + prefix;
            ApiProduct existing = ApiProduct.findByName(productName);
            if (existing == null) {
                ApiProduct p = new ApiProduct();
                p.name = productName;
                p.displayName = "MCP: " + prefix;
                p.description =
                        "Model Context Protocol server registered via Kuadrant. "
                                + "Subscribe to obtain an API key and connect using your MCP client of choice.";
                p.version = "v1";
                p.status = ApiStatus.ACTIVE;
                p.owner = ns;
                p.baseUrl = endpoint;
                p.protocol = ApiProtocol.MCP;
                p.mcpEndpoint = endpoint;
                p.approvalMode = ApprovalMode.MANUAL;
                p.published = true;
                p.rhclRef = ns + "/" + name;
                p.tags = new java.util.ArrayList<>(List.of("mcp", "ai"));
                p.persist();
                LOG.infof("Registered MCP product %s (endpoint %s)", productName, endpoint);
            } else if (!Objects.equals(existing.mcpEndpoint, endpoint)) {
                existing.mcpEndpoint = endpoint;
                existing.baseUrl = endpoint;
                existing.protocol = ApiProtocol.MCP;
                existing.updatedAt = java.time.Instant.now();
                LOG.infof("Updated MCP product %s endpoint -> %s", productName, endpoint);
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> spec(GenericKubernetesResource r) {
        Object s = r.getAdditionalProperties().get("spec");
        return s instanceof Map ? (Map<String, Object>) s : Map.of();
    }
}
