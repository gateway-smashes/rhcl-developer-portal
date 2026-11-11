package io.kuadrant.devportal.api;

import java.time.Instant;
import java.util.List;

import io.kuadrant.devportal.domain.ApiProduct;
import io.kuadrant.devportal.domain.Application;
import io.kuadrant.devportal.domain.ApplicationPlan;
import io.kuadrant.devportal.domain.PortalUser;
import io.kuadrant.devportal.domain.Subscription;
import io.kuadrant.devportal.rhcl.UsageSummary;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/** Transport records for the REST layer. Mapping helpers live alongside. */
public final class Dtos {

    private Dtos() {
    }

    public record ApiProductDto(Long id, String name, String displayName, String description, String version,
            String status, String owner, String baseUrl, String openApiSpecUrl, String approvalMode,
            List<String> tags, String contactTeam, String contactEmail, Instant updatedAt,
            String protocol, String mcpEndpoint, boolean published) {
        public static ApiProductDto of(ApiProduct p) {
            return new ApiProductDto(p.id, p.name, p.displayName, p.description, p.version, p.status.name(),
                    p.owner, p.baseUrl, p.openApiSpecUrl, p.approvalMode.name(), p.tags, p.contactTeam,
                    p.contactEmail, p.updatedAt, p.protocol.name(), p.mcpEndpoint, p.published);
        }
    }

    public record PlanDto(Long id, String name, String description, String tier, int rpmLimit, long dailyQuota,
            long monthlyQuota, boolean approvalRequired, boolean active, Long apiProductId) {
        public static PlanDto of(ApplicationPlan p) {
            return new PlanDto(p.id, p.name, p.description, p.tier, p.rpmLimit, p.dailyQuota, p.monthlyQuota,
                    p.approvalRequired, p.active, p.apiProductId);
        }
    }

    public record ApplicationDto(Long id, String name, String description, String organization, String environment,
            String callbackUrl, String technicalContact, Instant createdAt) {
        public static ApplicationDto of(Application a) {
            return new ApplicationDto(a.id, a.name, a.description, a.organization, a.environment.name(),
                    a.callbackUrl, a.technicalContact, a.createdAt);
        }
    }

    public record CreateApplicationRequest(@NotBlank String name, String description, String organization,
            String environment, String callbackUrl, String technicalContact) {
    }

    public record SubscriptionDto(Long id, Long apiProductId, String apiProductName, Long applicationId,
            String applicationName, Long applicationPlanId, String planTier, String status, String environment,
            String useCase, String apiKeyPreview, Instant createdAt, Instant approvedAt, String rejectionReason) {
    }

    public record CreateSubscriptionRequest(@NotNull Long apiProductId, @NotNull Long applicationId,
            @NotNull Long applicationPlanId, String environment, String useCase) {
    }

    /** Returned once, at creation/rotation: includes the plaintext key. */
    public record ApiCredentialDto(String keyId, String apiKey, String keyPreview, String headerName,
            String hostname, String curlExample) {
    }

    public record ProfileDto(Long id, String username, String email, String displayName, String organization,
            List<String> roles, List<ApplicationDto> applications, List<SubscriptionDto> subscriptions) {
        public static ProfileDto of(PortalUser u, List<ApplicationDto> apps, List<SubscriptionDto> subs) {
            return new ProfileDto(u.id, u.username, u.email, u.displayName, u.organization,
                    List.copyOf(u.roles), apps, subs);
        }
    }

    public record UsageDto(long totalRequests, long successCount, long blockedCount, long error4xxCount,
            long error5xxCount, double avgLatencyMs, long limitRemaining, double usagePercent, Instant quotaResetAt,
            List<UsageSummary.Point> series, List<TopProductDto> topProducts, String metricsSource) {
        public static UsageDto of(UsageSummary s) {
            return new UsageDto(s.totalRequests(), s.successCount(), s.blockedCount(), s.error4xxCount(),
                    s.error5xxCount(), s.avgLatencyMs(), s.limitRemaining(), s.usagePercent(), s.quotaResetAt(),
                    s.series(), List.of(), s.metricsSource());
        }

        /** Per-subscription input row for aggregate(). */
        public record AggregateInput(Subscription subscription, UsageSummary usage) {
        }

        /**
         * Sum the per-subscription summaries into a single dashboard view.
         * Avg latency is weighted by request count so a heavy quiet client
         * doesn't drag the headline number down. Quota fields aren't summed
         * — they're plan-scoped concepts that don't aggregate cleanly, so
         * we return zeros and the UI hides the quota ring for "All".
         */
        public static UsageDto aggregate(List<AggregateInput> rows) {
            long total = 0, ok = 0, blocked = 0, e4 = 0, e5 = 0;
            double latencyNum = 0; // weighted sum
            // bucketByTimestamp keeps the timeseries comparable across the
            // sources — they should already share the same step (UsageQuery
            // defaults), so equal timestamps line up.
            var bucketByTimestamp = new java.util.LinkedHashMap<Instant, long[]>(); // [req, ok, blocked]
            var byProduct = new java.util.LinkedHashMap<String, long[]>();           // name -> [req]
            for (var row : rows) {
                var u = row.usage();
                total += u.totalRequests();
                ok += u.successCount();
                blocked += u.blockedCount();
                e4 += u.error4xxCount();
                e5 += u.error5xxCount();
                latencyNum += u.avgLatencyMs() * u.totalRequests();
                for (var p : u.series()) {
                    long[] cur = bucketByTimestamp.computeIfAbsent(p.timestamp(), k -> new long[3]);
                    cur[0] += p.requestCount();
                    cur[1] += p.successCount();
                    cur[2] += p.blockedCount();
                }
                ApiProduct product = ApiProduct.findById(row.subscription().apiProductId);
                String pname = product != null && product.displayName != null
                    ? product.displayName
                    : (product != null ? product.name : "api-" + row.subscription().apiProductId);
                byProduct.computeIfAbsent(pname, k -> new long[1])[0] += u.totalRequests();
            }
            double latency = total > 0 ? latencyNum / total : 0.0;
            var merged = bucketByTimestamp.entrySet().stream()
                .map(e -> new UsageSummary.Point(e.getKey(), e.getValue()[0], e.getValue()[1], e.getValue()[2]))
                .toList();
            var top = byProduct.entrySet().stream()
                .map(e -> new TopProductDto(e.getKey(), e.getValue()[0]))
                .sorted((a, b) -> Long.compare(b.requestCount(), a.requestCount()))
                .toList();
            // Roll the per-row sources up: any unattributed row taints the whole
            // aggregate (so the UI warns); otherwise real > mock > none.
            String source = rows.stream().map(r -> r.usage().metricsSource()).reduce(UsageSummary.SOURCE_NONE, (acc, s) -> {
                if (UsageSummary.SOURCE_UNATTRIBUTED.equals(acc) || UsageSummary.SOURCE_UNATTRIBUTED.equals(s)) {
                    return UsageSummary.SOURCE_UNATTRIBUTED;
                }
                if (UsageSummary.SOURCE_PER_CONSUMER.equals(acc) || UsageSummary.SOURCE_PER_CONSUMER.equals(s)) {
                    return UsageSummary.SOURCE_PER_CONSUMER;
                }
                if (UsageSummary.SOURCE_MOCK.equals(acc) || UsageSummary.SOURCE_MOCK.equals(s)) {
                    return UsageSummary.SOURCE_MOCK;
                }
                return UsageSummary.SOURCE_NONE;
            });
            return new UsageDto(total, ok, blocked, e4, e5, latency, 0L, 0.0, Instant.EPOCH, merged, top, source);
        }
    }

    /** Per-product slice surfaced in the aggregate view's "Top products" card. */
    public record TopProductDto(String name, long requestCount) {
    }

    public record AdminApiRequest(@NotBlank String name, @NotBlank String displayName, String description,
            String version, String status, String owner, String baseUrl, String openApiSpecUrl, String approvalMode,
            List<String> tags, String contactTeam, String contactEmail, Boolean published) {
    }

    public record ReviewRequest(String reason) {
    }

    /** POST result that may carry a one-time credential (auto-approve / approve). */
    public record SubscriptionResultDto(SubscriptionDto subscription, ApiCredentialDto credential) {
    }
}
