import { Info } from "lucide-react";
import type { Usage } from "../api/types";

/**
 * Honest-metrics banner. Renders only when usage numbers can't be attributed
 * to the consumer's own key — i.e. RHCL 1.5's per-consumer TelemetryPolicy
 * projection isn't installed, so the backend fell back to per-API totals
 * across all consumers. This replaces the old behaviour where a missing
 * projection silently showed zeros. For every other source we render nothing.
 */
export default function UsageSourceNote({ source }: { source?: Usage["metricsSource"] }) {
  if (source !== "unattributed") return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
      <Info size={16} className="mt-0.5 shrink-0" />
      <div>
        <span className="font-semibold">Showing per-API totals across all consumers.</span>{" "}
        Per-subscription attribution needs the RHCL <code className="font-mono">TelemetryPolicy</code>{" "}
        consumer-metric projection, which isn&apos;t installed on this gateway yet. Numbers below are
        not scoped to your API key.
      </div>
    </div>
  );
}
