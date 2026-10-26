import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  Check,
  Copy,
  CreditCard,
  Receipt,
  RefreshCw,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  useBilling,
  useChargeRecurring,
  useChargeSubscription,
  usePlans,
  useRemoveCard,
  useSaveCard,
  useSubscriptions,
} from "../api/hooks";
import type { ApiCredential, Payment, Plan, Subscription } from "../api/types";
import { Badge, Button, Card, CardBody, EmptyState, SectionHeading, Spinner, cx } from "../components/ui";
import PaymentForm, { formatMoney, type TokenizedCard } from "../components/PaymentForm";

export default function Billing() {
  const { data: billing, isLoading } = useBilling();
  const { data: subs } = useSubscriptions();
  const { data: plans } = usePlans();

  const charge = useChargeSubscription();
  const renew = useChargeRecurring();
  const saveCard = useSaveCard();
  const removeCard = useRemoveCard();

  const [payingSub, setPayingSub] = useState<number | null>(null);
  const [addingCard, setAddingCard] = useState(false);
  const [issued, setIssued] = useState<ApiCredential | null>(null);
  const [error, setError] = useState<string | null>(null);

  const planById = useMemo(() => {
    const m = new Map<number, Plan>();
    (plans ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [plans]);

  if (isLoading || !billing) return <Spinner />;

  const method = billing.methods[0] ?? null;
  const paidSubs = (subs ?? []).filter((s) => planById.get(s.applicationPlanId)?.paid);

  const doCharge = async (sub: Subscription, card: TokenizedCard) => {
    setError(null);
    try {
      const res = await charge.mutateAsync({
        subscriptionId: sub.id,
        paymentToken: card.token,
        saveCard: true,
        cardLast4: card.last4 ?? undefined,
        cardBrand: card.brand ?? undefined,
      } as never);
      setPayingSub(null);
      if (res.payment.status !== "APPROVED") {
        setError(`Payment ${res.payment.status.toLowerCase()}: ${res.payment.gatewayMessage ?? "declined"}`);
      } else if (res.credential) {
        setIssued(res.credential);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doAddCard = async (card: TokenizedCard) => {
    setError(null);
    try {
      await saveCard.mutateAsync({ paymentToken: card.token, cardLast4: card.last4 ?? undefined, cardBrand: card.brand ?? undefined } as never);
      setAddingCard(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Billing</h1>
          <p className="text-sm text-slate-500">Pay for your paid plans and manage your card.</p>
        </div>
        <GatewayBadge mode={billing.config.mode} />
      </header>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {issued && <IssuedKey credential={issued} onClose={() => setIssued(null)} />}

      {/* --- Payment method -------------------------------------------------- */}
      <section>
        <SectionHeading title="Payment method" subtitle="Saved in the NMI Customer Vault for recurring charges." />
        <Card>
          <CardBody>
            {method ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-14 place-items-center rounded-lg bg-slate-900 text-white">
                    <CreditCard size={18} />
                  </div>
                  <div>
                    <div className="font-semibold capitalize text-slate-800">
                      {method.cardBrand ?? "Card"} •••• {method.cardLast4 ?? "----"}
                    </div>
                    <div className="text-xs text-slate-400">
                      {method.expMonth && method.expYear ? `Expires ${method.expMonth}/${method.expYear}` : "Saved card"}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" onClick={() => removeCard.mutate(method.id)} disabled={removeCard.isPending}>
                  <Trash2 size={15} /> Remove
                </Button>
              </div>
            ) : addingCard ? (
              <PaymentForm config={billing.config} submitLabel="Save card" submitting={saveCard.isPending} onToken={doAddCard} />
            ) : (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-slate-500">
                  <Wallet size={16} /> No saved card yet.
                </span>
                <Button variant="secondary" onClick={() => setAddingCard(true)}>
                  <CreditCard size={15} /> Add a card
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      </section>

      {/* --- Paid subscriptions --------------------------------------------- */}
      <section>
        <SectionHeading title="Plans & charges" subtitle="Paid plans activate once the first charge is approved." />
        {paidSubs.length === 0 ? (
          <EmptyState
            icon={<Receipt size={22} />}
            title="No paid plans yet"
            hint="Subscribe to a paid plan (Silver or Gold) and it will show up here to pay."
            action={
              <Link to="/products">
                <Button>Browse APIs</Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {paidSubs.map((sub) => {
              const plan = planById.get(sub.applicationPlanId)!;
              const paying = payingSub === sub.id;
              const active = sub.status === "APPROVED";
              return (
                <Card key={sub.id}>
                  <CardBody>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800">{sub.apiProductName}</span>
                          <Badge tone={plan.tier}>{plan.name}</Badge>
                          <Badge tone={sub.status}>{sub.status}</Badge>
                        </div>
                        <div className="mt-0.5 text-sm text-slate-500">
                          {sub.applicationName} · <span className="font-semibold text-slate-700">{formatMoney(plan.priceCents, plan.currency)}</span>/mo
                        </div>
                      </div>
                      {active ? (
                        <Button
                          variant="secondary"
                          onClick={() => renew.mutate(sub.id)}
                          disabled={renew.isPending || !method}
                          title={method ? "Run this month's charge" : "Add a card first"}
                        >
                          <RefreshCw size={15} /> Charge this month
                        </Button>
                      ) : (
                        <Button onClick={() => setPayingSub(paying ? null : sub.id)}>
                          <CreditCard size={15} /> {paying ? "Cancel" : `Pay ${formatMoney(plan.priceCents, plan.currency)}`}
                        </Button>
                      )}
                    </div>
                    {paying && !active && (
                      <div className="mt-4 border-t border-slate-100 pt-4">
                        <PaymentForm
                          config={billing.config}
                          submitLabel={`Pay ${formatMoney(plan.priceCents, plan.currency)} & activate`}
                          submitting={charge.isPending}
                          onToken={(card) => doCharge(sub, card)}
                        />
                      </div>
                    )}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* --- History -------------------------------------------------------- */}
      <section>
        <SectionHeading title="Payment history" />
        <Card>
          <CardBody className="p-0">
            {billing.payments.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-slate-400">No charges yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium">Amount</th>
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">Card</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.payments.map((p) => (
                    <PaymentRow key={p.id} p={p} />
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function PaymentRow({ p }: { p: Payment }) {
  const tone = p.status === "APPROVED" ? "success" : p.status === "DECLINED" ? "REJECTED" : p.status === "ERROR" ? "SUSPENDED" : "PENDING";
  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="px-5 py-3 text-slate-600">{new Date(p.createdAt).toLocaleString()}</td>
      <td className="px-5 py-3 font-semibold text-slate-800">{formatMoney(p.amountCents, p.currency)}</td>
      <td className="px-5 py-3 text-slate-500 capitalize">{p.kind.toLowerCase()}</td>
      <td className="px-5 py-3 text-slate-500">{p.cardLast4 ? `•••• ${p.cardLast4}` : "—"}</td>
      <td className="px-5 py-3">
        <Badge tone={tone}>{p.status}</Badge>
      </td>
      <td className="px-5 py-3 font-mono text-xs text-slate-400">{p.gatewayTransactionId ?? "—"}</td>
    </tr>
  );
}

function GatewayBadge({ mode }: { mode: string }) {
  const live = mode === "nmi";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset",
        live ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-amber-50 text-amber-700 ring-amber-600/20",
      )}
    >
      <BadgeCheck size={13} /> {live ? "NMI sandbox" : "Mock gateway"}
    </span>
  );
}

function IssuedKey({ credential, onClose }: { credential: ApiCredential; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
      <div className="flex items-center gap-2 text-emerald-800">
        <BadgeCheck size={18} /> <span className="font-semibold">Payment approved — subscription activated 🎉</span>
      </div>
      <p className="mt-1 text-sm text-emerald-700">Your API key is ready. Save it — you won&apos;t see it again.</p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 truncate rounded-xl bg-white px-3 py-2.5 font-mono text-sm text-slate-800 ring-1 ring-emerald-200">
          {credential.apiKey}
        </code>
        <Button
          variant="secondary"
          onClick={() => {
            navigator.clipboard.writeText(credential.apiKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
