import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCircle2, Copy, PartyPopper, Plus } from "lucide-react";
import {
  useApi,
  useApiPlans,
  useApis,
  useApplications,
  useBillingConfig,
  useChargeSubscription,
  useCreateApplication,
  useProfile,
  useSubscribe,
} from "../api/hooks";
import { usePortalAuth } from "../auth/auth";
import { Badge, Button, Card, CardBody, cx, Field, Input, Select, Spinner } from "../components/ui";
import type { ApiCredential, ApiProduct, Application, BillingConfig, Plan, Subscription } from "../api/types";
import { productVisual } from "../lib/products";
import PaymentForm, { formatMoney, type TokenizedCard } from "../components/PaymentForm";

// Wizard shape:
//   - From /products/:id/subscribe → start at "Select Application" (product is fixed).
//   - From /applications/new       → start at "Choose API Product" so the user
//     picks which API they're building against before everything else.
//   - A "Payment" step is inserted before "API Key" only when the chosen plan
//     is paid (priceCents > 0) — the subscription must be charged to activate.

export default function Subscribe() {
  const { id } = useParams();
  const navigate = useNavigate();

  // The product can come from the URL (Subscribe entry from a product page),
  // or be picked in the wizard itself (entry from Applications → New).
  const urlPid = id ? Number(id) : null;
  const [pickedPid, setPickedPid] = useState<number | null>(null);
  const pid = urlPid ?? pickedPid;
  const productPicker = urlPid === null;

  const { data: product } = useApi(pid ?? 0);
  const { data: plans } = useApiPlans(pid ?? 0);
  const { data: apps } = useApplications();
  const { data: profile } = useProfile();
  const { data: billingConfig } = useBillingConfig();
  const subscribe = useSubscribe();
  const charge = useChargeSubscription();

  const [step, setStep] = useState(0);
  const [appId, setAppId] = useState<number | null>(null);
  const [planId, setPlanId] = useState<number | null>(null);
  const [credential, setCredential] = useState<ApiCredential | null>(null);
  const [pending, setPending] = useState(false);
  const [createdSub, setCreatedSub] = useState<Subscription | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  const app = apps?.find((a) => a.id === appId);
  const plan = plans?.find((p) => p.id === planId);
  const paid = !!plan?.paid;

  // Dynamic step list — the Payment step only exists for a paid plan.
  const steps = useMemo(() => {
    const base = productPicker
      ? ["Choose Product", "Select Application", "Choose Plan", "Review"]
      : ["Select Application", "Choose Plan", "Review"];
    return [...base, ...(paid ? ["Payment"] : []), "API Key"];
  }, [productPicker, paid]);

  // Pre-select an existing plan when the user already subscribes to this
  // (product, application) — so re-running the wizard "remembers" the prior
  // choice instead of forcing them to pick again from scratch.
  const existingPlanId = useMemo(() => {
    if (!profile || !appId || !pid) return null;
    const match = profile.subscriptions.find(
      (s) => s.applicationId === appId && s.apiProductId === pid && s.applicationPlanId,
    );
    return match?.applicationPlanId ?? null;
  }, [profile, appId, pid]);

  useEffect(() => {
    if (existingPlanId && planId == null) setPlanId(existingPlanId);
  }, [existingPlanId, planId]);

  const stepKind = (i: number): string => steps[i];
  const lastStep = steps.length - 1;

  // Review → create the subscription. Free plans finish here (key or pending
  // approval). Paid plans stay PENDING and advance to the Payment step, which
  // charges them and — on approval — returns the key.
  const submit = async () => {
    if (!appId || !planId || !pid) return;
    const res = await subscribe.mutateAsync({ apiProductId: pid, applicationId: appId, applicationPlanId: planId });
    if (paid) {
      setCreatedSub(res.subscription);
      setStep(steps.indexOf("Payment"));
    } else if (res.credential) {
      setCredential(res.credential);
      setStep(lastStep);
    } else {
      setPending(true);
      setStep(lastStep);
    }
  };

  const pay = async (card: TokenizedCard) => {
    if (!createdSub) return;
    setPayError(null);
    const res = await charge.mutateAsync({
      subscriptionId: createdSub.id,
      paymentToken: card.token,
      saveCard: true,
      cardLast4: card.last4 ?? undefined,
      cardBrand: card.brand ?? undefined,
    } as never);
    if (res.payment.status !== "APPROVED") {
      setPayError(`Payment ${res.payment.status.toLowerCase()}: ${res.payment.gatewayMessage ?? "declined"}`);
      return;
    }
    if (res.credential) setCredential(res.credential);
    else setPending(true);
    setStep(lastStep);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to={urlPid ? `/products/${urlPid}` : "/applications"}
        className="mb-5 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={16} /> {urlPid ? product?.displayName ?? "Product" : "Applications"}
      </Link>

      <Stepper steps={steps} step={step} />

      <div className="mt-7 animate-fade-up">
        {stepKind(step) === "Choose Product" && (
          <StepProduct selected={pid} onSelect={setPickedPid} onNext={() => setStep(step + 1)} />
        )}
        {stepKind(step) === "Select Application" && (
          <StepApplication apps={apps} selected={appId} onSelect={setAppId} onBack={productPicker ? () => setStep(step - 1) : undefined} onNext={() => setStep(step + 1)} />
        )}
        {stepKind(step) === "Choose Plan" && (
          <StepPlan plans={plans ?? []} selected={planId} onSelect={setPlanId} onBack={() => setStep(step - 1)} onNext={() => setStep(step + 1)} />
        )}
        {stepKind(step) === "Review" && (
          <StepReview
            product={product}
            app={app}
            plan={plan}
            submitting={subscribe.isPending}
            onBack={() => setStep(step - 1)}
            onConfirm={submit}
          />
        )}
        {stepKind(step) === "Payment" && (
          <StepPayment
            plan={plan}
            config={billingConfig}
            submitting={charge.isPending}
            error={payError}
            onToken={pay}
          />
        )}
        {stepKind(step) === "API Key" && (
          <StepDone credential={credential} pending={pending} product={product} onDone={() => navigate("/applications")} />
        )}
      </div>
    </div>
  );
}

function Stepper({ steps, step }: { steps: string[]; step: number }) {
  return (
    <div className="flex items-center">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 items-center last:flex-none">
          <div className="flex items-center gap-2">
            <div
              className={cx(
                "grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold transition",
                i < step ? "bg-emerald-500 text-white" : i === step ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-500",
              )}
            >
              {i < step ? <Check size={16} /> : i + 1}
            </div>
            <span className={cx("hidden text-sm font-medium sm:block", i <= step ? "text-slate-800" : "text-slate-400")}>
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={cx("mx-3 h-0.5 flex-1 rounded", i < step ? "bg-emerald-400" : "bg-slate-200")} />
          )}
        </div>
      ))}
    </div>
  );
}

function StepApplication({
  apps,
  selected,
  onSelect,
  onBack,
  onNext,
}: {
  apps: Application[] | undefined;
  selected: number | null;
  onSelect: (id: number) => void;
  onBack?: () => void;
  onNext: () => void;
}) {
  const create = useCreateApplication();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const doCreate = async () => {
    if (!name) return;
    const a = await create.mutateAsync({ name, environment: "SANDBOX" });
    onSelect(a.id);
    setCreating(false);
    setName("");
  };

  return (
    <Card>
      <CardBody>
        <h2 className="text-lg font-bold text-slate-900">Select an application</h2>
        <p className="mb-4 text-sm text-slate-500">Choose the application to associate with this subscription.</p>

        {!apps ? (
          <Spinner />
        ) : (
          <div className="space-y-2.5">
            {apps.map((a) => (
              <button
                key={a.id}
                onClick={() => onSelect(a.id)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition",
                  selected === a.id ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200 hover:border-slate-300",
                )}
              >
                <div className={cx("grid h-5 w-5 place-items-center rounded-full border", selected === a.id ? "border-brand-600 bg-brand-600" : "border-slate-300")}>
                  {selected === a.id && <Check size={12} className="text-white" />}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-slate-800">{a.name}</div>
                  <div className="text-xs text-slate-400">{a.organization}</div>
                </div>
                <Badge tone="neutral">{a.environment}</Badge>
              </button>
            ))}

            {creating ? (
              <div className="flex items-end gap-2 rounded-xl border border-slate-200 p-3.5">
                <div className="flex-1">
                  <Field label="New application name">
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" />
                  </Field>
                </div>
                <Button onClick={doCreate} disabled={!name || create.isPending}>
                  {create.isPending ? "Creating…" : "Create"}
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 p-3 text-sm font-medium text-brand-600 hover:bg-brand-50"
              >
                <Plus size={16} /> Create new application
              </button>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-between">
          {onBack ? (
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft size={15} /> Back
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={!selected} onClick={onNext}>
            Continue <ArrowRight size={15} />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// Pick an API Product — first step of the wizard when entering from
// Applications → New (without a product pre-selected via URL).
function StepProduct({
  selected,
  onSelect,
  onNext,
}: {
  selected: number | null;
  onSelect: (id: number) => void;
  onNext: () => void;
}) {
  const { data: products } = useApis();
  return (
    <Card>
      <CardBody>
        <h2 className="text-lg font-bold text-slate-900">Choose an API Product</h2>
        <p className="mb-4 text-sm text-slate-500">Pick the API you want this application to consume.</p>
        {!products ? (
          <Spinner />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {products.map((p) => (
              <ProductTile key={p.id} product={p} selected={selected === p.id} onSelect={() => onSelect(p.id)} />
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-end">
          <Button disabled={!selected} onClick={onNext}>
            Continue <ArrowRight size={15} />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function ProductTile({
  product,
  selected,
  onSelect,
}: {
  product: ApiProduct;
  selected: boolean;
  onSelect: () => void;
}) {
  const { Icon, tile } = productVisual(`${product.name} ${product.tags?.join(" ")}`);
  return (
    <button
      onClick={onSelect}
      className={cx(
        "flex items-center gap-3 rounded-xl border p-3 text-left transition",
        selected ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200 hover:border-slate-300",
      )}
    >
      <div className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tile)}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-slate-800">{product.displayName}</div>
        <div className="truncate text-xs text-slate-400">{product.version} · {product.status}</div>
      </div>
      {selected && <Check size={16} className="text-brand-600" />}
    </button>
  );
}

function StepPlan({
  plans,
  selected,
  onSelect,
  onBack,
  onNext,
}: {
  plans: Plan[];
  selected: number | null;
  onSelect: (id: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card>
      <CardBody>
        <h2 className="text-lg font-bold text-slate-900">Choose a plan</h2>
        <p className="mb-4 text-sm text-slate-500">Select the plan that fits your needs.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {plans.map((p) => {
            const rec = p.tier === "silver";
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={cx(
                  "relative rounded-2xl border p-4 text-left transition",
                  selected === p.id ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200 hover:border-slate-300",
                )}
              >
                {rec && (
                  <span className="absolute -top-2.5 left-4 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    Recommended
                  </span>
                )}
                <div className="flex items-center justify-between">
                  <span className="font-bold capitalize text-slate-900">{p.name}</span>
                  <Badge tone={p.tier}>{p.tier}</Badge>
                </div>
                <div className="mt-2 text-2xl font-extrabold text-slate-900">
                  {p.paid ? formatMoney(p.priceCents, p.currency) : "Free"}
                  {p.paid && <span className="text-xs font-medium text-slate-400"> /mo</span>}
                </div>
                <ul className="mt-2 space-y-1 text-xs text-slate-500">
                  <li>{p.rpmLimit === 0 ? "Unlimited RPM" : `${p.rpmLimit.toLocaleString()} RPM`}</li>
                  <li>{p.dailyQuota > 0 ? `${p.dailyQuota.toLocaleString()}/day` : "Unlimited daily"}</li>
                  <li>{p.paid ? "Activates on payment" : p.approvalRequired ? "Manual approval" : "Instant approval"}</li>
                </ul>
              </button>
            );
          })}
        </div>
        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={15} /> Back
          </Button>
          <Button disabled={!selected} onClick={onNext}>
            Continue <ArrowRight size={15} />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function StepReview({
  product,
  app,
  plan,
  submitting,
  onBack,
  onConfirm,
}: {
  product?: { displayName: string };
  app?: Application;
  plan?: Plan;
  submitting: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <Card>
      <CardBody>
        <h2 className="text-lg font-bold text-slate-900">Review your subscription</h2>
        <dl className="mt-4 divide-y divide-slate-100 text-sm">
          <Row label="Product" value={product?.displayName} />
          <Row label="Application" value={app?.name} />
          <Row label="Plan" value={<Badge tone={plan?.tier}>{plan?.name}</Badge>} />
          <Row
            label="Price"
            value={plan ? (plan.paid ? `${formatMoney(plan.priceCents, plan.currency)}/mo` : "Free") : "—"}
          />
          <Row label="Limit" value={plan ? (plan.rpmLimit === 0 ? "Unlimited" : `${plan.rpmLimit} RPM`) : "—"} />
          <Row label="Approval" value={plan?.paid ? "On payment" : plan?.approvalRequired ? "Manual" : "Instant"} />
          <Row label="Environment" value={app?.environment} />
        </dl>
        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={15} /> Back
          </Button>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting ? "Submitting…" : plan?.paid ? "Continue to payment" : "Confirm subscription"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value ?? "—"}</dd>
    </div>
  );
}

function StepPayment({
  plan,
  config,
  submitting,
  error,
  onToken,
}: {
  plan?: Plan;
  config?: BillingConfig;
  submitting: boolean;
  error: string | null;
  onToken: (card: TokenizedCard) => void;
}) {
  if (!plan) return <Spinner />;
  const price = formatMoney(plan.priceCents, plan.currency);
  return (
    <Card>
      <CardBody>
        <h2 className="text-lg font-bold text-slate-900">Payment</h2>
        <p className="mb-4 text-sm text-slate-500">
          Activate the <span className="font-semibold capitalize">{plan.name}</span> plan — {price}/month.
        </p>
        <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="text-sm text-slate-600">Due today</span>
          <span className="text-lg font-extrabold text-slate-900">{price}</span>
        </div>
        {error && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        )}
        {config ? (
          <PaymentForm config={config} submitLabel={`Pay ${price} & activate`} submitting={submitting} onToken={onToken} />
        ) : (
          <Spinner />
        )}
      </CardBody>
    </Card>
  );
}

function StepDone({
  credential,
  pending,
  product,
  onDone,
}: {
  credential: ApiCredential | null;
  pending: boolean;
  product?: { displayName: string };
  onDone: () => void;
}) {
  const auth = usePortalAuth();
  const isAdmin = auth.roles.includes("api-admin") || auth.roles.includes("api-owner");
  const [copied, setCopied] = useState(false);
  const copy = (v: string) => {
    navigator.clipboard.writeText(v);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  if (pending && !credential) {
    return (
      <Card>
        <CardBody className="py-10 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-amber-50 text-amber-500">
            <CheckCircle2 size={28} />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Request submitted</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            Your subscription to <strong>{product?.displayName}</strong> is awaiting approval. You&apos;ll receive your API
            key here as soon as it&apos;s approved.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={onDone}>Go to Applications</Button>
            {isAdmin && (
              <Link to="/admin/subscriptions">
                <Button variant="secondary">
                  Review pending requests <ArrowUpRight size={14} />
                </Button>
              </Link>
            )}
          </div>
        </CardBody>
      </Card>
    );
  }

  if (!credential) return <Spinner />;

  const node = `import fetch from "node-fetch";\nawait fetch("https://${credential.hostname}/api/v1/accounts/summary", {\n  headers: { "${credential.headerName}": "${credential.apiKey}" }\n});`;

  return (
    <Card className="overflow-hidden">
      <div className="hero-sheen px-6 py-8 text-center">
        <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-lift">
          <PartyPopper size={30} />
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900">Subscription approved 🎉</h2>
        <p className="mt-1 text-sm text-slate-500">Your API key is ready to use.</p>
      </div>
      <CardBody className="space-y-5">
        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-600">Your API key</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-xl bg-slate-100 px-3 py-2.5 font-mono text-sm text-slate-800">
              {credential.apiKey}
            </code>
            <Button variant="secondary" onClick={() => copy(credential.apiKey)}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-amber-600">Save this key — you won&apos;t be able to view it again.</p>
        </div>

        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-600">Test your first call</div>
          <pre className="overflow-x-auto rounded-xl bg-ink-900 p-4 font-mono text-xs leading-relaxed text-emerald-200 scroll-thin">
            {credential.curlExample}
          </pre>
        </div>

        <details className="rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">Node.js snippet</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-200 scroll-thin">{node}</pre>
        </details>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onDone}>
            View applications
          </Button>
          <Button onClick={onDone}>Done</Button>
        </div>
      </CardBody>
    </Card>
  );
}
