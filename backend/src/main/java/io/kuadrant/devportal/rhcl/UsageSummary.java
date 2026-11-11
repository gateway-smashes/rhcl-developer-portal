package io.kuadrant.devportal.rhcl;

import java.time.Instant;
import java.util.List;

/**
 * Aggregated consumption for a subscription over a window, plus a time series
 * for charting. Mirrors the dashboard indicators in spec §4.8.
 *
 * <p>{@code metricsSource} tells the UI where the numbers came from so it never
 * silently shows a misleading zero:
 * <ul>
 *   <li>{@code mock} — synthetic data (mock mode).</li>
 *   <li>{@code per-consumer} — real, attributed to this subscription via the
 *       {@code TelemetryPolicy} per-consumer metric label.</li>
 *   <li>{@code unattributed} — the per-consumer projection isn't installed, so
 *       the numbers are per-API totals across <em>all</em> consumers; the UI
 *       must label them as such.</li>
 *   <li>{@code none} — metrics backend unavailable or genuinely no traffic.</li>
 * </ul>
 */
public record UsageSummary(
        long totalRequests,
        long successCount,
        long blockedCount,
        long error4xxCount,
        long error5xxCount,
        double avgLatencyMs,
        long limitRemaining,
        double usagePercent,
        Instant quotaResetAt,
        List<Point> series,
        String metricsSource) {

    public static final String SOURCE_MOCK = "mock";
    public static final String SOURCE_PER_CONSUMER = "per-consumer";
    public static final String SOURCE_UNATTRIBUTED = "unattributed";
    public static final String SOURCE_NONE = "none";

    /** One time bucket in the usage series. */
    public record Point(
            Instant timestamp,
            long requestCount,
            long successCount,
            long blockedCount) {
    }
}
