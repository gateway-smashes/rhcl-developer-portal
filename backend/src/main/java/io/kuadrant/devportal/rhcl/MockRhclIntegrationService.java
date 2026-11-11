package io.kuadrant.devportal.rhcl;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import org.jboss.logging.Logger;

import io.kuadrant.devportal.domain.ApiProduct;
import io.kuadrant.devportal.domain.ApplicationPlan;
import io.kuadrant.devportal.domain.Subscription;

import io.quarkus.arc.lookup.LookupUnlessProperty;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/**
 * Default integration backend. Generates API keys and synthetic usage entirely
 * in-process, so the full portal flow works without a cluster. Active unless
 * {@code portal.rhcl.mode=kubernetes}.
 */
@LookupUnlessProperty(name = "portal.rhcl.mode", stringValue = "kubernetes")
@ApplicationScoped
public class MockRhclIntegrationService implements RhclIntegrationService {

    private static final Logger LOG = Logger.getLogger(MockRhclIntegrationService.class);

    @Inject
    PortalConfig config;

    @Override
    public ApiCredential provisionApiKey(Subscription subscription) {
        String plain = ApiKeys.generate();
        String hostname = resolveHostname(subscription);
        String keyId = "mock-" + subscription.id;
        LOG.infof("[mock] provisioned API key for subscription %d", subscription.id);
        return new ApiCredential(keyId, plain, ApiKeys.mask(plain),
                config.apiKeyHeader(), hostname, config.namespace() + "/mock-secret-" + subscription.id);
    }

    @Override
    public void revokeApiKey(Subscription subscription) {
        LOG.infof("[mock] revoked API key for subscription %d", subscription.id);
    }

    @Override
    public ApiCredential rotateApiKey(Subscription subscription) {
        LOG.infof("[mock] rotated API key for subscription %d", subscription.id);
        return provisionApiKey(subscription);
    }

    @Override
    public void applyPlan(Subscription subscription, ApplicationPlan plan) {
        LOG.infof("[mock] applied plan %s (tier=%s) to subscription %d", plan.name, plan.tier, subscription.id);
    }

    @Override
    public UsageSummary getUsage(Subscription subscription, UsageQuery query) {
        // Deterministic-per-subscription synthetic series so the dashboard is stable.
        Random rnd = new Random(subscription.id == null ? 1 : subscription.id);
        List<UsageSummary.Point> series = new ArrayList<>();
        long total = 0, success = 0, blocked = 0, e4 = 0, e5 = 0;
        Instant cursor = query.from().truncatedTo(ChronoUnit.HOURS);
        Instant now = query.to();
        while (cursor.isBefore(now)) {
            long req = 40 + rnd.nextInt(160);
            long blk = rnd.nextInt(12);
            long err4 = rnd.nextInt(8);
            long err5 = rnd.nextInt(3);
            long ok = Math.max(0, req - blk - err4 - err5);
            series.add(new UsageSummary.Point(cursor, req, ok, blk));
            total += req; success += ok; blocked += blk; e4 += err4; e5 += err5;
            cursor = cursor.plusSeconds(Math.max(3600, query.stepSeconds()));
        }
        double pct = Math.min(100.0, total / 50.0);
        Instant reset = Instant.now().plus(1, ChronoUnit.DAYS).truncatedTo(ChronoUnit.DAYS);
        return new UsageSummary(total, success, blocked, e4, e5,
                12.0 + rnd.nextInt(40), Math.max(0, 5000 - total), pct, reset, series,
                UsageSummary.SOURCE_MOCK);
    }

    @Override
    public String describe() {
        return "mock (in-process, no cluster)";
    }

    private String resolveHostname(Subscription subscription) {
        ApiProduct product = ApiProduct.findById(subscription.apiProductId);
        if (product != null && product.baseUrl != null) {
            return product.baseUrl.replaceFirst("^https?://", "").replaceAll("/.*$", "");
        }
        return config.defaultHostname().orElse("api.sandbox.local");
    }
}
