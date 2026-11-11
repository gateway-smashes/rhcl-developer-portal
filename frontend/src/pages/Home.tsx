import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Check,
  Code2,
  Copy,
  Gauge,
  Headphones,
  KeyRound,
  LifeBuoy,
  MessageCircle,
  PlayCircle,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { useApis, useProfile, useUsage } from "../api/hooks";
import { usePortalAuth } from "../auth/auth";
import { Badge, Button, Card, CardBody, Skeleton } from "../components/ui";
import { productVisual } from "../lib/products";
import PendingApprovalsBanner from "../components/PendingApprovalsBanner";

/**
 * Home — developer-portal landing.
 *
 * Reverts the KPI-heavy dashboard that felt corporate and instead
 * leads with what a developer actually wants on first load: a hero
 * search, popular API chips, and a Get Started checklist they can
 * tick through. KPIs / usage / cost moved to Analytics, where they
 * belong.
 */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  const auth = usePortalAuth();
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const { data: products } = useApis();

  const approved = (profile?.subscriptions ?? []).filter((s) => s.status === "APPROVED");
  const { data: usage } = useUsage(approved[0]?.id, 7);

  const firstName = profile?.displayName?.split(" ")[0] ?? auth.username ?? "there";

  // Onboarding checklist — the right-side hero card. Mapped to actual
  // user state so checks reflect reality. The first step is gated on
  // `auth.isAuthenticated` rather than always-true so a guest viewing
  // the home page doesn't see "Create your account" already ticked.
  const onboarding = [
    { label: "Create your account", done: auth.isAuthenticated },
    { label: "Verify your email", done: !!profile?.email },
    { label: "Create an application", done: (profile?.applications.length ?? 0) > 0 },
    { label: "Subscribe to a product", done: approved.length > 0 },
    { label: "Generate an API key", done: approved.some((s) => !!s.apiKeyPreview) },
    { label: "Make your first API call", done: (usage?.totalRequests ?? 0) > 0 },
  ];

  const [q, setQ] = useState("");
  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/products${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  };

  return (
    <>
      {/* Pending approvals queue banner — preserved from the standalone's
          previous Home so owners/admins still see key requests on landing. */}
      <PendingApprovalsBanner />

      {/* ---------- Hero + Popular APIs (left) · Get started (right) ---------- */}
      {/* Single 2-col row: the left column stacks the greeting/search and the
          Popular APIs grid so the APIs sit high on the page, while the
          "Let's get you started" card runs down the right, spanning both. */}
      <section className="grid items-start gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-8">
          <div className="animate-fade-up">
            <h1 className="text-page-title text-slate-900">
              {greeting()}, {firstName}! <span>👋</span>
            </h1>
            <p className="mt-2 text-[15px] text-slate-500">
              Build powerful integrations with Connectivity Link APIs.
            </p>

            {/* Big body search — primary entry point for a returning dev. */}
            <form onSubmit={onSearch} className="relative mt-6">
              <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search APIs, endpoints, guides, examples…"
                className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 pl-12 pr-4 text-sm shadow-surface-1 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
              />
            </form>

            {/* Popular chips — sourced from real products so newly
                added APIs appear here without code changes. */}
            {products && products.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Popular:</span>
                {products.slice(0, 4).map((p) => (
                  <Link
                    key={p.id}
                    to={`/products/${p.id}`}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {p.displayName}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Popular APIs — pulled up into the hero row, beside the card. */}
          <div>
            <div className="mb-4 flex items-end justify-between gap-4">
              <h2 className="text-section-title text-slate-900">Popular APIs</h2>
              <Link to="/products" className="text-sm font-semibold text-brand-600 link-underline">
                View all APIs →
              </Link>
            </div>
            {!products ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-44" />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {products.slice(0, 4).map((p) => {
                  const { Icon, tile } = productVisual(`${p.name} ${p.tags?.join(" ")}`);
                  return (
                    <Link key={p.id} to={`/products/${p.id}`} className="block">
                      <Card hover className="h-full">
                        <CardBody className="flex h-full flex-col">
                          <div className={`mb-3 grid h-11 w-11 place-items-center rounded-xl ${tile}`}>
                            <Icon size={22} />
                          </div>
                          <h3 className="text-card-title text-slate-900">{p.displayName}</h3>
                          <p className="mt-1 line-clamp-2 flex-1 text-sm text-slate-500">{p.description}</p>
                          <div className="mt-4 flex items-center justify-between">
                            <span className="text-xs text-slate-400">{p.version} · REST</span>
                            <Badge tone={p.status}>{p.status}</Badge>
                          </div>
                          <div className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
                            Explore <ArrowRight size={14} />
                          </div>
                        </CardBody>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <OnboardingCard steps={onboarding} />
      </section>

      {/* ---------- Quick start · Recent docs · Why CL ---------- */}
      <section className="mt-10 grid gap-5 lg:grid-cols-3">
        <QuickStartCard products={products ?? []} />
        <RecentDocsCard />
        <WhyConnectivityLinkCard />
      </section>

      {/* ---------- Need help footer ---------- */}
      <section className="mt-10">
        <Card>
          <CardBody className="flex flex-wrap items-center gap-4">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <Headphones size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-card-title text-slate-900">Need help?</div>
              <p className="mt-0.5 text-sm text-slate-500">
                Our documentation, tutorials and support are here for you.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/documentation">
                <Button variant="secondary" size="sm">
                  <BookOpen size={14} /> Documentation
                </Button>
              </Link>
              <Link to="/documentation">
                <Button variant="secondary" size="sm">
                  <PlayCircle size={14} /> Tutorials
                </Button>
              </Link>
              <Button variant="secondary" size="sm">
                <MessageCircle size={14} /> Community
              </Button>
              <Button variant="secondary" size="sm">
                <LifeBuoy size={14} /> Contact support
              </Button>
            </div>
          </CardBody>
        </Card>
      </section>
    </>
  );
}

// -------------------------------------------------------------------

function OnboardingCard({ steps }: { steps: { label: string; done: boolean }[] }) {
  const currentIndex = steps.findIndex((s) => !s.done);
  return (
    <Card elevation={2} className="hero-sheen relative overflow-hidden animate-fade-up">
      <CardBody className="p-6">
        {/* 60/40 split — text + checklist on the left, rocket
            illustration on the right. The illustration is sized to
            feel like a background feature (per the mockup) rather
            than a small badge in the top-right corner. */}
        <div className="grid grid-cols-[1fr_auto] gap-4">
          <div className="min-w-0">
            <h2 className="text-card-title text-slate-900">Let&apos;s get you started</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Follow the steps to make your first API call.
            </p>
          </div>
          <img
            src="/rocket.png"
            alt=""
            aria-hidden="true"
            className="h-44 w-auto shrink-0 object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
              const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
              if (fb) fb.style.display = "grid";
            }}
          />
          <div
            className="hidden h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"
            aria-hidden="true"
          >
            <Rocket size={20} />
          </div>
        </div>
        <ul className="mt-5 space-y-2.5">
          {steps.map((s, i) => {
            const isCurrent = i === currentIndex;
            return (
              <li key={s.label} className="flex items-center gap-2.5 text-sm">
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                    s.done
                      ? "bg-emerald-500 text-white"
                      : isCurrent
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {s.done ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={
                    s.done
                      ? "text-slate-700 line-through decoration-slate-300"
                      : isCurrent
                      ? "font-semibold text-slate-900"
                      : "text-slate-500"
                  }
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

function QuickStartCard({ products }: { products: { id: number; displayName: string; baseUrl: string }[] }) {
  const [sel, setSel] = useState(0);
  const [copied, setCopied] = useState(false);
  const product = products[sel];
  const base = product?.baseUrl ?? "https://sandbox.api.example.com";
  const curl = `curl ${base}/accounts \\\n  -H "api-key: bk_live_••••••••" \\\n  -H "Content-Type: application/json"`;
  return (
    <Card elevation={2}>
      <CardBody>
        <div className="mb-1 text-card-title text-slate-900">Quick start</div>
        <p className="text-sm text-slate-500">Try {product?.displayName ?? "an API"} in a few seconds.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={sel}
            onChange={(e) => setSel(Number((e.target as HTMLSelectElement).value))}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {products.map((p, i) => (
              <option key={p.id} value={i}>
                {p.displayName} (Sandbox)
              </option>
            ))}
          </select>
          <Link to={product ? `/products/${product.id}/subscribe` : "/products"}>
            <Button size="sm">
              <KeyRound size={14} /> Get sandbox key
            </Button>
          </Link>
        </div>
        <div className="relative mt-3 rounded-xl bg-ink-900 p-4">
          <button
            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
            onClick={() => {
              navigator.clipboard.writeText(curl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
          </button>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-emerald-200 scroll-thin">
            {curl}
          </pre>
        </div>
        <Link
          to="/documentation"
          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 link-underline"
        >
          View full quick start guide →
        </Link>
      </CardBody>
    </Card>
  );
}

const DOC_LINKS = [
  { icon: ShieldCheck, title: "Authentication guide", desc: "API keys, OAuth2 and headers" },
  { icon: Gauge, title: "Rate limits", desc: "Quotas, limits and best practices" },
  { icon: Code2, title: "SDKs", desc: "Libraries for popular languages" },
  { icon: BookOpen, title: "API reference", desc: "Endpoints and schemas" },
];

function RecentDocsCard() {
  return (
    <Card elevation={2}>
      <CardBody>
        <div className="mb-3 text-card-title text-slate-900">Recent documentation</div>
        <ul className="space-y-2">
          {DOC_LINKS.map((l) => (
            <li key={l.title}>
              <Link
                to="/documentation"
                className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-slate-50"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                  <l.icon size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-800">{l.title}</div>
                  <div className="truncate text-xs text-slate-500">{l.desc}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          to="/documentation"
          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 link-underline"
        >
          Browse all docs →
        </Link>
      </CardBody>
    </Card>
  );
}

const WHY_BULLETS = [
  { icon: ShieldCheck, title: "Secure by design", desc: "Built on enterprise-grade platform" },
  { icon: Zap, title: "High performance", desc: "Low latency and high availability" },
  { icon: Sparkles, title: "Developer friendly", desc: "Simple, consistent and well documented" },
  { icon: Rocket, title: "Scalable", desc: "Grow from sandbox to production" },
];

function WhyConnectivityLinkCard() {
  return (
    <Card elevation={2}>
      <CardBody>
        <div className="mb-3 text-card-title text-slate-900">Why Connectivity Link?</div>
        <ul className="space-y-3">
          {WHY_BULLETS.map((b) => (
            <li key={b.title} className="flex items-start gap-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                <Check size={14} strokeWidth={3} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-800">{b.title}</div>
                <div className="text-xs text-slate-500">{b.desc}</div>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
