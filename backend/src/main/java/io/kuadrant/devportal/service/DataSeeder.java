package io.kuadrant.devportal.service;

import java.util.List;

import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import io.kuadrant.devportal.domain.ApiProduct;
import io.kuadrant.devportal.domain.ApplicationPlan;
import io.kuadrant.devportal.domain.Enums.ApiStatus;
import io.kuadrant.devportal.domain.Enums.ApprovalMode;

import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.transaction.Transactional;

/**
 * Seeds the catalog with demo data on first start (when the product table is
 * empty), so the portal is immediately walkable. Mirrors the cluster's
 * {@code banking-api} APIProduct + gold/silver/bronze PlanPolicy tiers.
 */
@ApplicationScoped
public class DataSeeder {

    private static final Logger LOG = Logger.getLogger(DataSeeder.class);

    @ConfigProperty(name = "portal.seed.enabled", defaultValue = "true")
    boolean seedEnabled;

    @ConfigProperty(name = "portal.seed.hostname", defaultValue = "banking-api-connectivity.apps.example.com")
    String hostname;

    // OpenAPI spec URL the backend proxies server-side; defaults to the
    // in-cluster banking-api service so it is reachable without the gateway.
    @ConfigProperty(name = "portal.seed.openapi-url",
            defaultValue = "http://banking-api-v1.rhcl-apps.svc:8080/q/openapi")
    String openApiUrl;

    @Transactional
    void onStart(@Observes StartupEvent ev) {
        if (!seedEnabled) {
            return;
        }
        if (ApiProduct.count() > 0) {
            reconcile();
            return;
        }
        LOG.info("Seeding demo catalog (banking-api + plans)...");

        ApiProduct banking = new ApiProduct();
        banking.name = "banking-api";
        banking.displayName = "Banking API";
        banking.description = "Sample banking API exposed through Red Hat Connectivity Link — demo seed, customise via portal.seed.* properties.";
        banking.version = "v1";
        banking.status = ApiStatus.ACTIVE;
        banking.owner = "RHCL PoC Team";
        banking.baseUrl = "https://" + hostname + "/api/v1";
        banking.openApiSpecUrl = openApiUrl;
        banking.approvalMode = ApprovalMode.MANUAL;
        banking.published = true;
        banking.tags = List.of("banking", "poc", "rhcl");
        banking.contactTeam = "RHCL PoC Team";
        banking.contactEmail = "rhcl-poc@example.com";
        banking.rhclRef = "rhcl-apps/banking-api";
        banking.persist();

        seedPlan(banking.id, "Gold", "Unlimited tier for trusted consumers.", "gold", 0, 0, 0, false, 19_900);
        seedPlan(banking.id, "Silver", "50 requests/minute.", "silver", 50, 50_000, 1_000_000, false, 4_900);
        seedPlan(banking.id, "Bronze", "10 requests/minute — good for getting started.", "bronze", 10, 5_000, 100_000, false, 0);

        // A second, beta product to make the catalog feel real.
        ApiProduct payments = new ApiProduct();
        payments.name = "payments-api";
        payments.displayName = "Payments API";
        payments.description = "Initiate and track payments (beta). Subject to change.";
        payments.version = "v0";
        payments.status = ApiStatus.BETA;
        payments.owner = "Payments Squad";
        payments.baseUrl = "https://" + hostname + "/payments/v0";
        payments.approvalMode = ApprovalMode.AUTOMATIC;
        payments.published = true;
        payments.tags = List.of("payments", "beta");
        payments.contactTeam = "Payments Squad";
        payments.contactEmail = "payments@example.com";
        payments.persist();
        seedPlan(payments.id, "Free", "Auto-approved sandbox tier.", "bronze", 10, 1_000, 10_000, false, 0);

        LOG.info("Seed complete.");
    }

    /** Keep the banking-api spec URL aligned with config on every restart. */
    private void reconcile() {
        ApiProduct banking = ApiProduct.findByName("banking-api");
        if (banking != null && !openApiUrl.equals(banking.openApiSpecUrl)) {
            LOG.infof("Reconciling banking-api openApiSpecUrl -> %s", openApiUrl);
            banking.openApiSpecUrl = openApiUrl;
            banking.updatedAt = java.time.Instant.now();
        }
    }

    private void seedPlan(Long productId, String name, String desc, String tier, int rpm, long daily,
            long monthly, boolean approvalRequired, long priceCents) {
        ApplicationPlan p = new ApplicationPlan();
        p.apiProductId = productId;
        p.name = name;
        p.description = desc;
        p.tier = tier;
        p.rpmLimit = rpm;
        p.dailyQuota = daily;
        p.monthlyQuota = monthly;
        p.approvalRequired = approvalRequired;
        p.priceCents = priceCents;
        p.currency = "USD";
        p.active = true;
        p.persist();
    }
}
