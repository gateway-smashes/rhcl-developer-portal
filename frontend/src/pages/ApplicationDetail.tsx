import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Boxes,
  BookOpen,
  CheckCircle2,
  KeyRound,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useProfile, useRotateKey, useUsage } from "../api/hooks";
import CredentialDialog from "../components/CredentialDialog";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  ProgressRing,
  SectionHeading,
  Skeleton,
  Stat,
} from "../components/ui";
import { compact, timeAgo } from "../lib/format";
import type { ApiCredential, Subscription } from "../api/types";

/**
 * Application Detail — the per-app workspace.
 *
 * Layout follows the mockup:
 *   1. Back link + app header (name, env, org, health, settings)
 *   2. 5 KPI cards (Requests today, Success, Errors, Latency, Rate
 *      limit usage)
 *   3. Three-up: Requests over time chart · Products list · Credentials
 *   4. Two-up: Recent activity · Quick actions
 *   5. Insights row
 *
 * Per the global spec, this is a SUMMARY page — anything that needs
 * filtering / range picking / multi-day comparison hands off to
 * Analytics or the Open-in-Grafana link, both linked from here.
 */
export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const appId = Number(id);
  const { data: profile, isLoading } = useProfile();
  const [cred, setCred] = useState<ApiCredential | null>(null);

  const app = profile?.applications.find((a) => a.id === appId);
  const subs = useMemo(
    () => (profile?.subscriptions ?? []).filter((s) => s.applicationId === appId),
    [profile, appId],
  );
  const firstApproved = subs.find((s) => s.status === "APPROVED");
  const { data: usage } = useUsage(firstApproved?.id, 1);

  if (isLoading) return <Skeleton className="h-72" />;
  if (!app) {
    return (
      <EmptyState
        icon={<Boxes size={26} />}
        title="Application not found"
        hint="The application you tried to open no longer exists or you don't have access."
        action={
          <Link to="/applications">
            <Button>Back to applications</Button>
          </Link>
        }
      />
    );
  }

  // ---- Health derivation (mirrors the list page so the badge is
  // consistent between the row and the workspace). ----
  const hasPending = subs.some((s) => s.status === "PENDING");
  const hasAttention = subs.some((s) => ["REJECTED", "REVOKED", "SUSPENDED"].includes(s.status));
  const allApproved = subs.length > 0 && subs.every((s) => s.status === "APPROVED");
  const health = hasAttention
    ? { tone: "REJECTED", label: "Attention" }
    : hasPending
    ? { tone: "PENDING", label: "Pending" }
    : allApproved
    ? { tone: "ACTIVE", label: "Healthy" }
    : { tone: "neutral", label: "Idle" };

  // ---- KPI derivation from `usage`. When the app has no traffic
  // yet the row still renders with em-dashes so the layout doesn't
  // pop in once data arrives. ----
  const successRate =
    usage && usage.totalRequests > 0 ? ((usage.successCount / usage.totalRequests) * 100).toFixed(1) : "—";
  const errorRate =
    usage && usage.totalRequests > 0
      ? (((usage.error4xxCount + usage.error5xxCount) / usage.totalRequests) * 100).toFixed(1)
      : "—";
  const rateLimitPct = usage ? Math.round(usage.usagePercent) : 0;
  const reqSpark = usage?.series.map((p) => p.requestCount) ?? [];
  const blockedSpark = usage?.series.map((p) => p.blockedCount) ?? [];

  // ---- Chart series (small timeline, capped at 24 points so the
  // card matches the mockup proportions). ----
  const chartSeries = (usage?.series ?? []).slice(-24).map((p) => ({
    t: new Date(p.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    requests: p.requestCount,
  }));

  // ---- Activity timeline (subscription events). ----
  const activity = useMemo(() => {
    type Item = { text: string; at: string; icon: typeof Send; tone?: "good" | "neutral" };
    const ev: Item[] = [];
    for (const s of subs) {
      ev.push({ text: `${s.apiProductName} subscription requested`, at: s.createdAt, icon: Send });
      if (s.approvedAt)
        ev.push({
          text: `${s.apiProductName} access approved · key issued`,
          at: s.approvedAt,
          icon: KeyRound,
          tone: "good",
        });
    }
    return ev.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5);
  }, [subs]);

  // ---- Insights derived from real usage. With no traffic we show a
  // single honest "no data" card rather than canned affirmations. ----
  const insights: { tone: "positive" | "warning" | "neutral"; icon: React.ReactNode; title: string; detail: string }[] =
    (() => {
      if (!usage || usage.totalRequests === 0) {
        return [
          {
            tone: "neutral" as const,
            icon: <Activity size={18} />,
            title: "No traffic yet",
            detail: "Make your first API call with an issued key to populate usage insights.",
          },
        ];
      }
      const successNum = (usage.successCount / usage.totalRequests) * 100;
      const errorNum = ((usage.error4xxCount + usage.error5xxCount) / usage.totalRequests) * 100;
      return [
        {
          tone: successNum >= 99 ? "positive" : successNum >= 95 ? "neutral" : "warning",
          icon: <CheckCircle2 size={18} />,
          title: "Success rate",
          detail: `${successNum.toFixed(1)}% of requests returned 2xx/3xx in this window.`,
        },
        {
          tone: errorNum < 1 ? "positive" : errorNum < 5 ? "neutral" : "warning",
          icon: <Activity size={18} />,
          title: "Error rate",
          detail: `${errorNum.toFixed(1)}% errors (${compact(usage.error4xxCount)} 4xx · ${compact(usage.error5xxCount)} 5xx).`,
        },
        {
          tone: rateLimitPct > 80 ? "warning" : "neutral",
          icon: <Sparkles size={18} />,
          title: "Rate limit usage",
          detail: `${rateLimitPct}% of your plan's rate limit consumed.`,
        },
      ];
    })();

  return (
    <>
      {/* ---------- Back link ---------- */}
      <Link
        to="/applications"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 link-underline hover:text-slate-700"
      >
        <ArrowLeft size={16} /> Back to applications
      </Link>

      {/* ---------- App header ---------- */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4 animate-fade-up">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 shadow-surface-1">
            <Boxes size={26} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-page-title text-slate-900">{app.name}</h1>
              <Badge tone="neutral">{app.environment}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {app.organization} · Application ID{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                app-{app.id}
              </code>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={health.tone}>● {health.label}</Badge>
        </div>
      </div>

      {/* ---------- 5 KPI cards ---------- */}
      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {/* Deltas intentionally omitted: there's no prior-period baseline to
            compare against, so a trend arrow here would be fabricated. The
            sparkline shows the real in-window shape. */}
        <Stat
          label="Requests today"
          value={usage ? compact(usage.totalRequests) : "—"}
          sparkline={reqSpark}
        />
        <Stat
          label="Success rate"
          value={successRate === "—" ? "—" : `${successRate}%`}
          sparkline={reqSpark}
          sparklineColor="#10b981"
        />
        <Stat
          label="Errors"
          value={errorRate === "—" ? "—" : `${errorRate}%`}
          sparkline={blockedSpark}
          sparklineColor="#ef4444"
        />
        <Stat
          label="Avg. latency"
          value={usage ? `${usage.avgLatencyMs.toFixed(0)} ms` : "—"}
          sparkline={reqSpark}
          sparklineColor="#f59e0b"
        />
        <Card elevation={2} hover>
          {/* Rate-limit usage gets its own custom card because it
              needs a progress ring; the standard Stat layout would
              squash it. Keeps the row balanced visually. */}
          <CardBody className="p-5">
            <div className="flex items-start justify-between">
              <span className="text-caption uppercase text-slate-500">Rate limit usage</span>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <ShieldAlert size={16} />
              </span>
            </div>
            <div className="mt-2 flex items-center gap-4">
              <div>
                <div className="text-metric-sm tracking-tight text-slate-900">{rateLimitPct}%</div>
                <div className="text-xs text-slate-400">of 100%</div>
              </div>
              <ProgressRing
                value={rateLimitPct}
                size={56}
                stroke={6}
                label={null}
              />
            </div>
          </CardBody>
        </Card>
      </section>

      {/* ---------- Requests chart · Products · Credentials ---------- */}
      <section className="mt-8 grid gap-5 lg:grid-cols-3">
        <Card elevation={2}>
          <CardBody>
            <SectionHeading
              title="Requests over time"
              subtitle="Last 24 hours"
              action={
                <Link to="/analytics" className="text-sm font-semibold text-brand-600 link-underline">
                  Open full analytics →
                </Link>
              }
            />
            {chartSeries.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">
                No traffic in the last 24 hours.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartSeries} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="ad-req" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6d5efc" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6d5efc" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#94a3b8" }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Area type="monotone" dataKey="requests" stroke="#6d5efc" fill="url(#ad-req)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <SectionHeading
              title={`Products (${new Set(subs.map((s) => s.apiProductId)).size})`}
              action={
                subs[0] && (
                  <Link
                    to={`/products/${subs[0].apiProductId}`}
                    className="text-sm font-semibold text-brand-600 link-underline"
                  >
                    View all →
                  </Link>
                )
              }
            />
            {subs.length === 0 ? (
              <EmptyState
                icon={<Boxes size={22} />}
                title="No products yet"
                hint="Subscribe this application to a product to start consuming APIs."
                action={
                  <Link to="/products?intent=new-application">
                    <Button size="sm">Browse products</Button>
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-3">
                {Array.from(new Map(subs.map((s) => [s.apiProductId, s])).values())
                  .slice(0, 3)
                  .map((s) => (
                    <li
                      key={s.apiProductId}
                      className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-800">{s.apiProductName}</span>
                        <Badge tone={s.planTier}>{s.planTier}</Badge>
                      </div>
                      {s.status === "APPROVED" && (
                        <div className="mt-1 text-xs text-emerald-600">● Connected</div>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <SectionHeading
              title={`Credentials (${subs.filter((s) => s.apiKeyPreview).length})`}
              action={
                <Link to="/applications" className="text-sm font-semibold text-brand-600 link-underline">
                  View all →
                </Link>
              }
            />
            {subs.filter((s) => s.apiKeyPreview).length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">
                No keys yet — approve a subscription to issue one.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {subs
                  .filter((s) => s.apiKeyPreview)
                  .slice(0, 3)
                  .map((s) => (
                    <CredentialRow key={s.id} sub={s} onRotated={setCred} />
                  ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>

      {/* ---------- Recent activity · Quick actions ---------- */}
      <section className="mt-8 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card elevation={2}>
          <CardBody>
            <SectionHeading title="Recent activity" />
            {activity.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {activity.map((it, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                        it.tone === "good"
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-brand-50 text-brand-600"
                      }`}
                    >
                      <it.icon size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-700">{it.text}</p>
                      <p className="text-xs text-slate-400">{timeAgo(it.at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card elevation={2}>
          <CardBody>
            <SectionHeading title="Quick actions" />
            <div className="space-y-1.5 text-sm">
              <ActionLink
                onClick={() => navigate("/analytics")}
                icon={<TrendingUp size={14} />}
                label="View analytics"
              />
              <ActionLink
                onClick={() => navigate("/documentation")}
                icon={<BookOpen size={14} />}
                label="Open API documentation"
              />
              {firstApproved && (
                <ActionLink
                  icon={<RefreshCw size={14} />}
                  label="Rotate production key"
                  onClick={() => null}
                  href={`#rotate-${firstApproved.id}`}
                />
              )}
              <ActionLink
                icon={<KeyRound size={14} />}
                label="Generate new key"
                onClick={() => navigate("/products?intent=new-application")}
              />
            </div>
          </CardBody>
        </Card>
      </section>

      {/* ---------- Insights row (derived from real usage) ---------- */}
      <section className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {insights.map((it) => (
          <InsightCard key={it.title} tone={it.tone} icon={it.icon} title={it.title} detail={it.detail} />
        ))}
      </section>

      {cred && <CredentialDialog credential={cred} onClose={() => setCred(null)} />}
    </>
  );
}

// -------------------------------------------------------------------


function CredentialRow({
  sub,
  onRotated,
}: {
  sub: Subscription;
  onRotated: (c: ApiCredential) => void;
}) {
  const rotate = useRotateKey();
  return (
    <li className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-slate-500">Production Key</span>
        {sub.status === "APPROVED" && <Badge tone="ACTIVE">Active</Badge>}
      </div>
      <code className="mt-1 block truncate font-mono text-xs text-slate-700">
        {sub.apiKeyPreview ?? "pending"}
      </code>
      <button
        title="Rotate key"
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 link-underline"
        onClick={async () => onRotated(await rotate.mutateAsync(sub.id))}
        disabled={rotate.isPending}
      >
        <RefreshCw size={12} className={rotate.isPending ? "animate-spin" : ""} /> Generate new key
      </button>
    </li>
  );
}

function ActionLink({
  icon,
  label,
  onClick,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  href?: string;
}) {
  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        className="flex items-center justify-between rounded-lg px-3 py-2 text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
      >
        <span className="inline-flex items-center gap-2">
          <span className="text-brand-600">{icon}</span>
          {label}
        </span>
        <ArrowRight size={14} className="text-slate-400" />
      </a>
    );
  }
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
    >
      <span className="inline-flex items-center gap-2">
        <span className="text-brand-600">{icon}</span>
        {label}
      </span>
      <ArrowRight size={14} className="text-slate-400" />
    </button>
  );
}

function InsightCard({
  tone,
  icon,
  title,
  detail,
}: {
  tone: "positive" | "warning" | "neutral";
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  const toneCls =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50/40"
      : tone === "warning"
      ? "border-amber-200 bg-amber-50/40"
      : "border-slate-200 bg-white";
  const iconCls =
    tone === "positive"
      ? "bg-emerald-100 text-emerald-700"
      : tone === "warning"
      ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-600";
  return (
    <div className={`rounded-2xl border p-4 ${toneCls}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${iconCls}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-xs text-slate-600">{detail}</div>
        </div>
      </div>
    </div>
  );
}

