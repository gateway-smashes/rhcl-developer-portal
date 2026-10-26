import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Globe,
  Rocket,
  ShieldCheck,
  Star,
  Zap,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useApi, useApiPlans } from "../api/hooks";
import { api } from "../api/client";
import { PageHeader } from "../components/AppShell";
import { Badge, Button, Card, CardBody, Skeleton, Tabs } from "../components/ui";
import { productVisual } from "../lib/products";
import { formatMoney } from "../components/PaymentForm";
import type { Plan } from "../api/types";

const REST_TABS = ["Overview", "APIs", "Plans", "Getting Started", "Changelog", "Support"];
// MCP swaps "APIs" (which would imply REST endpoints) for "Tools" (the MCP
// JSON-RPC method that lists callable functions) and adds "Connect" with
// per-client snippets — Claude Desktop, Cline, mcp-inspector. "Playground"
// is the live tool-call form (Phase C).
const MCP_TABS = ["Overview", "Tools", "Connect", "Playground", "Plans", "Support"];

export default function ProductDetail() {
  const { id } = useParams();
  const pid = Number(id);
  const navigate = useNavigate();
  const { data: p, isLoading } = useApi(pid);
  const { data: plans } = useApiPlans(pid);
  const [tab, setTab] = useState("Overview");

  if (isLoading || !p) return <Skeleton className="h-72" />;
  const { Icon, tile } = productVisual(`${p.name} ${p.tags?.join(" ")}`);
  const isMcp = (p.protocol ?? "REST") === "MCP";
  const TABS = isMcp ? MCP_TABS : REST_TABS;

  return (
    <>
      <Link to="/products" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={16} /> Back to products
      </Link>

      {/* Hero */}
      <Card className="hero-sheen mb-6 overflow-hidden">
        <CardBody className="flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className={`grid h-20 w-20 shrink-0 place-items-center rounded-3xl ${tile}`}>
            <Icon size={40} />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">{p.displayName}</h1>
              <Badge tone={p.status}>{p.status}</Badge>
              {isMcp && <Badge tone="info">MCP</Badge>}
            </div>
            <p className="mt-2 max-w-2xl text-[15px] text-slate-600">{p.description}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <Meta>{(plans?.length ?? 0)} Plans</Meta>
              <Meta>{p.version}</Meta>
              <Meta>{isMcp ? "MCP" : "REST"}</Meta>
              <Meta>{isMcp ? "JSON-RPC 2.0" : "OpenAPI 3.0"}</Meta>
              <Meta tone="emerald">● Sandbox available</Meta>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={() => navigate(`/products/${pid}/subscribe`)}>
              <Rocket size={16} /> Start building
            </Button>
            <Button size="lg" variant="secondary" onClick={() => navigate(`/documentation?product=${pid}`)}>
              <BookOpen size={16} /> View documentation
            </Button>
          </div>
        </CardBody>
      </Card>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="mt-6 animate-fade-up">
        {tab === "Overview" && <Overview product={p} />}
        {tab === "APIs" && <ApisTab product={p} />}
        {tab === "Tools" && <McpToolsTab productId={pid} />}
        {tab === "Connect" && <McpConnectTab product={p} />}
        {tab === "Playground" && <McpPlaygroundTab productId={pid} />}
        {tab === "Plans" && <PlansTab plans={plans ?? []} onPick={() => navigate(`/products/${pid}/subscribe`)} />}
        {tab === "Getting Started" && <GettingStarted pid={pid} />}
        {tab === "Changelog" && <Changelog product={p} />}
        {tab === "Support" && <Support product={p} />}
      </div>
    </>
  );
}

function Meta({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-medium ${
        tone === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-white/70 text-slate-600 ring-1 ring-slate-200"
      }`}
    >
      {children}
    </span>
  );
}

const CAPS = [
  { icon: Globe, label: "Account Information" },
  { icon: Zap, label: "Balances" },
  { icon: ShieldCheck, label: "Transactions" },
  { icon: Rocket, label: "Payments" },
];

function Overview({ product }: { product: { description: string; baseUrl: string; contactTeam: string } }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardBody>
          <h3 className="font-bold text-slate-900">About this product</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{product.description}</p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {CAPS.map((c) => (
              <div key={c.label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-center">
                <c.icon size={20} className="mx-auto text-brand-500" />
                <div className="mt-2 text-xs font-medium text-slate-600">{c.label}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
      <div className="space-y-5">
        <Card>
          <CardBody>
            <h4 className="text-sm font-semibold text-slate-700">Base URL</h4>
            <code className="mt-2 block truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700">
              {product.baseUrl}
            </code>
            <h4 className="mt-4 text-sm font-semibold text-slate-700">Authentication</h4>
            <p className="mt-1 text-sm text-slate-500">API Key (Header) · <span className="font-mono">X-API-Key</span></p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ApisTab({ product }: { product: { baseUrl: string } }) {
  const endpoints = [
    { m: "GET", path: "/accounts" },
    { m: "GET", path: "/accounts/{id}/balances" },
    { m: "GET", path: "/transactions" },
    { m: "POST", path: "/payments" },
  ];
  return (
    <Card>
      <CardBody>
        <div className="divide-y divide-slate-100">
          {endpoints.map((e) => (
            <div key={e.path} className="flex items-center gap-3 py-3">
              <span
                className={`w-14 rounded-md px-2 py-0.5 text-center text-[11px] font-bold ${
                  e.m === "GET" ? "bg-emerald-50 text-emerald-700" : "bg-brand-50 text-brand-700"
                }`}
              >
                {e.m}
              </span>
              <code className="font-mono text-sm text-slate-700">{e.path}</code>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400">
          Full reference at <span className="font-mono">{product.baseUrl}</span> — open the Documentation tab to try it out.
        </p>
      </CardBody>
    </Card>
  );
}

function PlansTab({ plans, onPick }: { plans: Plan[]; onPick: () => void }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {plans.map((p) => {
        const recommended = p.tier === "silver";
        return (
          <Card key={p.id} className={recommended ? "relative ring-2 ring-brand-500" : ""}>
            {recommended && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-0.5 text-[11px] font-semibold text-white">
                Recommended
              </span>
            )}
            <CardBody>
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-bold capitalize text-slate-900">{p.name}</h4>
                <Badge tone={p.tier}>{p.tier}</Badge>
              </div>
              <div className="mt-3">
                <span className="text-3xl font-extrabold text-slate-900">
                  {p.paid ? formatMoney(p.priceCents, p.currency) : "Free"}
                </span>
                {p.paid && <span className="text-sm text-slate-400"> /mo</span>}
              </div>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <Li>{p.rpmLimit === 0 ? "Unlimited RPM" : `${p.rpmLimit.toLocaleString()} RPM`}</Li>
                <Li>{p.dailyQuota > 0 ? `${p.dailyQuota.toLocaleString()} req/day` : "Unlimited daily"}</Li>
                <Li>{p.monthlyQuota > 0 ? `${p.monthlyQuota.toLocaleString()} req/month` : "Unlimited monthly"}</Li>
                <Li>{p.paid ? "Activates on payment" : p.approvalRequired ? "Manual approval" : "Instant approval"}</Li>
                <Li>Sandbox &amp; Production</Li>
              </ul>
              <Button className="mt-5 w-full" variant={recommended ? "primary" : "secondary"} onClick={onPick}>
                Choose {p.name}
              </Button>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <Check size={15} className="text-emerald-500" /> {children}
    </li>
  );
}

function GettingStarted({ pid }: { pid: number }) {
  const navigate = useNavigate();
  const steps = [
    { t: "Create an Application", d: "Register your application to obtain credentials." },
    { t: "Subscribe to a Plan", d: "Choose the plan that fits your needs." },
    { t: "Get your API Key", d: "Instant access after approval." },
    { t: "Make your first call", d: "Start building amazing apps." },
  ];
  return (
    <Card>
      <CardBody className="space-y-2">
        {steps.map((s, i) => (
          <button
            key={s.t}
            onClick={() => navigate(`/products/${pid}/subscribe`)}
            className="flex w-full items-center gap-4 rounded-xl p-3 text-left transition hover:bg-slate-50"
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
              {i + 1}
            </span>
            <div className="flex-1">
              <div className="font-semibold text-slate-800">{s.t}</div>
              <div className="text-sm text-slate-500">{s.d}</div>
            </div>
            <ChevronRight size={18} className="text-slate-300" />
          </button>
        ))}
      </CardBody>
    </Card>
  );
}

function Changelog({ product }: { product: { version: string; updatedAt: string } }) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3">
          <Star size={18} className="mt-0.5 text-amber-500" />
          <div>
            <div className="font-semibold text-slate-800">{product.version} — current release</div>
            <div className="text-sm text-slate-500">Last updated {new Date(product.updatedAt).toLocaleDateString()}</div>
            <p className="mt-2 text-sm text-slate-600">Stable release. Backwards-compatible additions are published here.</p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function Support({ product }: { product: { contactTeam: string; contactEmail: string } }) {
  return (
    <Card>
      <CardBody className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Team</span>
          <span className="font-medium text-slate-800">{product.contactTeam || "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Email</span>
          <a href={`mailto:${product.contactEmail}`} className="font-medium text-brand-600 hover:underline">
            {product.contactEmail || "—"}
          </a>
        </div>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// MCP-specific tabs
// ---------------------------------------------------------------------------

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Calls the backend proxy that does the MCP `tools/list` JSON-RPC. */
function useMcpTools(productId: number) {
  return useQuery({
    queryKey: ["mcp", "tools", productId],
    queryFn: () => api.get<{ result?: { tools?: McpTool[] }; error?: { message?: string } }>(
      `/api/catalog/apis/${productId}/mcp/tools`,
    ),
  });
}

function McpToolsTab({ productId }: { productId: number }) {
  const { data, isLoading, error } = useMcpTools(productId);
  if (isLoading) return <Skeleton className="h-40" />;
  if (error) {
    return (
      <Card>
        <CardBody>
          <div className="text-sm text-red-600">Failed to load tools — {(error as Error).message}</div>
        </CardBody>
      </Card>
    );
  }
  const tools = data?.result?.tools ?? [];
  if (tools.length === 0) {
    return (
      <Card>
        <CardBody>
          <div className="text-sm text-slate-500">
            The MCP server returned no tools, or rejected the unauthenticated
            <code className="mx-1">tools/list</code>. Subscribe to obtain an API
            key, then revisit the Playground tab to call tools live.
          </div>
        </CardBody>
      </Card>
    );
  }
  return (
    <div className="grid gap-3">
      {tools.map((t) => (
        <Card key={t.name}>
          <CardBody>
            <div className="flex items-baseline justify-between gap-2">
              <code className="font-mono text-sm font-semibold text-slate-900">{t.name}</code>
              {t.inputSchema && (
                <span className="text-[11px] text-slate-400">
                  {Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties || {}).length} input(s)
                </span>
              )}
            </div>
            {t.description && (
              <p className="mt-1 text-sm text-slate-600">{t.description}</p>
            )}
            {t.inputSchema && (
              <details className="mt-3 rounded-lg border border-slate-100 p-2">
                <summary className="cursor-pointer text-xs font-medium text-slate-500">
                  input schema
                </summary>
                <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 font-mono text-xs text-slate-200 scroll-thin">
                  {JSON.stringify(t.inputSchema, null, 2)}
                </pre>
              </details>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

const CONNECT_SNIPPETS: { id: string; label: string; render: (url: string) => string }[] = [
  {
    id: "claude",
    label: "Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json)",
    render: (url) =>
      JSON.stringify(
        {
          mcpServers: {
            "my-rhcl-server": {
              type: "http",
              url,
              headers: { "api-key": "<paste your API key>" },
            },
          },
        },
        null,
        2,
      ),
  },
  {
    id: "cline",
    label: "Cline / Continue (~/.cline/mcp_settings.json)",
    render: (url) =>
      JSON.stringify(
        {
          servers: [{ name: "rhcl", url, headers: { "api-key": "<paste your API key>" } }],
        },
        null,
        2,
      ),
  },
  {
    id: "inspector",
    label: "mcp-inspector (npx)",
    render: (url) => `npx @modelcontextprotocol/inspector --url ${url} \\
  --header "api-key=<paste your API key>"`,
  },
];

function McpConnectTab({ product }: { product: { mcpEndpoint: string | null; displayName: string } }) {
  const url = product.mcpEndpoint || "https://gateway.example.com/mcp";
  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <h3 className="font-bold text-slate-900">Endpoint</h3>
          <div className="mt-2">
            <code className="block truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm text-slate-700">
              {url}
            </code>
            <p className="mt-2 text-xs text-slate-500">
              Authenticate with the <code>api-key</code> header. Subscribe to a
              plan above to obtain a key.
            </p>
          </div>
        </CardBody>
      </Card>
      {CONNECT_SNIPPETS.map((s) => (
        <Card key={s.id}>
          <CardBody>
            <div className="mb-2 text-sm font-semibold text-slate-700">{s.label}</div>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-emerald-200 scroll-thin">
              {s.render(url)}
            </pre>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function McpPlaygroundTab({ productId }: { productId: number }) {
  const { data: toolsData } = useMcpTools(productId);
  const tools = toolsData?.result?.tools ?? [];
  const [selected, setSelected] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [argsJson, setArgsJson] = useState("{}");
  const [response, setResponse] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const call = async () => {
    setCalling(true);
    setResponse(null);
    try {
      const parsedArgs = argsJson.trim() ? JSON.parse(argsJson) : {};
      const result = await api.post<unknown>(`/api/catalog/apis/${productId}/mcp/call`, {
        name: selected,
        arguments: parsedArgs,
        apiKey: apiKey || undefined,
      });
      setResponse(JSON.stringify(result, null, 2));
    } catch (e) {
      setResponse(`Error: ${(e as Error).message}`);
    } finally {
      setCalling(false);
    }
  };
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="mb-1 text-xs font-medium text-slate-600">Tool</div>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">— pick a tool —</option>
              {tools.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="mb-1 text-xs font-medium text-slate-600">API key</div>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="bk_live_…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
            />
          </label>
        </div>
        <label className="block">
          <div className="mb-1 text-xs font-medium text-slate-600">Arguments (JSON)</div>
          <textarea
            rows={5}
            value={argsJson}
            onChange={(e) => setArgsJson(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
          />
        </label>
        <Button onClick={call} disabled={!selected || calling}>
          {calling ? "Calling…" : "Call tool"}
        </Button>
        {response !== null && (
          <pre className="mt-3 overflow-x-auto rounded-xl bg-ink-900 p-4 font-mono text-xs leading-relaxed text-emerald-200 scroll-thin">
            {response}
          </pre>
        )}
      </CardBody>
    </Card>
  );
}
