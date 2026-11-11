import { useState } from "react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useProfile, useUsage } from "../api/hooks";
import { PageHeader } from "../components/AppShell";
import UsageSourceNote from "../components/UsageSourceNote";
import { Card, CardBody, EmptyState, ProgressRing, Select, SectionHeading, Skeleton, Stat } from "../components/ui";
import { compact } from "../lib/format";
import { LineChart } from "lucide-react";

/**
 * Aggregate view by default — sums across every APPROVED subscription the
 * user has — and the dropdown becomes a drill-down into a single product.
 * The aggregate is computed server-side (see Dtos.UsageDto.aggregate) so
 * we don't bombard the API with N requests from the browser.
 *
 * Quota ring is hidden in the aggregate because quota is a plan-scoped
 * concept that doesn't aggregate cleanly (different plans, different
 * windows). The "Top products" card replaces it instead.
 */
const ALL = "__all__" as const;
type Selection = number | typeof ALL;

export default function Analytics() {
  const { data: profile } = useProfile();
  const approved = (profile?.subscriptions ?? []).filter((s) => s.status === "APPROVED");
  const [selection, setSelection] = useState<Selection>(ALL);
  const [days, setDays] = useState(7);

  const subId = selection === ALL ? undefined : selection;
  const { data: usage, isLoading } = useUsage(subId, days);
  const isAggregate = selection === ALL;

  if (approved.length === 0) {
    return (
      <>
        <PageHeader title="Analytics" subtitle="Monitor consumption, performance and quota across your products." />
        <EmptyState
          icon={<LineChart size={26} />}
          title="No usage data yet"
          hint="Usage metrics will appear after your first API call on an approved subscription."
        />
      </>
    );
  }

  // KPI fallbacks: when there's no traffic, show "—" instead of misleading
  // "100%" / "0" zeros. Easier to read than a green badge that lies.
  const hasTraffic = (usage?.totalRequests ?? 0) > 0;
  const successRate = hasTraffic && usage
    ? ((usage.successCount / usage.totalRequests) * 100).toFixed(1) + "%"
    : "—";
  const errorRate = hasTraffic && usage
    ? (((usage.error4xxCount + usage.error5xxCount) / usage.totalRequests) * 100).toFixed(2) + "%"
    : "—";

  const series = (usage?.series ?? []).map((p) => ({
    t: new Date(p.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    requests: p.requestCount,
    blocked: p.blockedCount,
  }));

  const donut = [
    { name: "4xx", value: usage?.error4xxCount ?? 0, color: "#f59e0b" },
    { name: "5xx", value: usage?.error5xxCount ?? 0, color: "#ef4444" },
    { name: "Rate limited", value: usage?.blockedCount ?? 0, color: "#6d5efc" },
  ].filter((d) => d.value > 0);

  // For the aggregate, use the backend-computed topProducts (sorted desc by
  // request count). For drill-down into one sub, fall back to "this product"
  // as a single row so the card isn't empty.
  const topProducts = isAggregate
    ? (usage?.topProducts ?? [])
    : (() => {
        const cur = approved.find((s) => s.id === selection);
        return cur ? [{ name: cur.apiProductName, requestCount: usage?.totalRequests ?? 0 }] : [];
      })();

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Monitor consumption, performance and quota across your products."
        actions={
          <div className="flex gap-2">
            <Select
              value={selection}
              onChange={(e) => {
                const v = e.target.value;
                setSelection(v === ALL ? ALL : Number(v));
              }}
              style={{ minWidth: 200 }}
            >
              <option value={ALL}>All products (aggregate)</option>
              {approved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.apiProductName} · {s.applicationName}
                </option>
              ))}
            </Select>
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </Select>
          </div>
        }
      />

      {isLoading || !usage ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-6">
          <UsageSourceNote source={usage.metricsSource} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat
              label="Total Requests"
              value={compact(usage.totalRequests)}
              delta={hasTraffic ? { value: "vs last period", up: true } : undefined}
            />
            <Stat
              label="Success Rate"
              value={successRate}
              delta={hasTraffic ? { value: "healthy", up: true } : undefined}
            />
            <Stat label="Blocked" value={compact(usage.blockedCount)} hint="rate-limited" />
            <Stat label="Avg Latency" value={hasTraffic ? `${usage.avgLatencyMs.toFixed(0)} ms` : "—"} />
            <Stat label="Error Rate" value={errorRate} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card className={isAggregate ? "lg:col-span-3" : "lg:col-span-2"}>
              <CardBody>
                <SectionHeading title="Requests over time" />
                {series.length === 0 ? (
                  <p className="py-16 text-center text-sm text-slate-400">
                    No traffic recorded yet for this period. Metrics populate once requests flow through the gateway.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={series} margin={{ left: -18, right: 8, top: 8 }}>
                      <defs>
                        <linearGradient id="a-req" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6d5efc" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#6d5efc" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#94a3b8" }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                      <Area type="monotone" dataKey="requests" stroke="#6d5efc" fill="url(#a-req)" strokeWidth={2} />
                      <Area type="monotone" dataKey="blocked" stroke="#ef4444" fill="transparent" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>

            {/* Quota only renders in drill-down mode — it's a plan-scoped
                concept and aggregating across plans is nonsensical (different
                quotas, different windows). */}
            {!isAggregate && (
              <Card>
                <CardBody className="flex flex-col items-center">
                  <SectionHeading title="Quota usage" />
                  <ProgressRing
                    value={usage.usagePercent}
                    size={150}
                    stroke={14}
                    label={
                      <div>
                        <div className="text-3xl font-extrabold text-slate-900">{Math.round(usage.usagePercent)}%</div>
                        <div className="text-xs text-slate-400">used</div>
                      </div>
                    }
                  />
                  <div className="mt-4 w-full space-y-1.5 text-sm">
                    <Row label="Remaining" value={compact(usage.limitRemaining)} />
                    <Row label="Resets" value={new Date(usage.quotaResetAt).toLocaleDateString()} />
                  </div>
                </CardBody>
              </Card>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardBody>
                <SectionHeading title="Errors breakdown" />
                {donut.length === 0 ? (
                  <p className="py-12 text-center text-sm text-emerald-600">No errors in this period 🎉</p>
                ) : (
                  <div className="flex items-center gap-6">
                    <ResponsiveContainer width={160} height={160}>
                      <PieChart>
                        <Pie data={donut} dataKey="value" innerRadius={48} outerRadius={70} paddingAngle={3}>
                          {donut.map((d) => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <ul className="space-y-2 text-sm">
                      {donut.map((d) => (
                        <li key={d.name} className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                          <span className="text-slate-600">{d.name}</span>
                          <span className="ml-2 font-semibold text-slate-800">{compact(d.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <SectionHeading title="Top products" />
                {topProducts.length === 0 || !hasTraffic ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No traffic on any of your subscriptions in this window.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {topProducts.map((p) => (
                      <li key={p.name} className="flex items-center justify-between py-2.5 text-sm">
                        <span className="text-slate-700">{p.name}</span>
                        <span className="font-semibold text-slate-800">{compact(p.requestCount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}
