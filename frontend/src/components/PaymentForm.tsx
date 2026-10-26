import { useEffect, useRef, useState } from "react";
import { CreditCard, Lock, ShieldCheck } from "lucide-react";
import type { BillingConfig } from "../api/types";
import { Button, Field, Input, cx } from "./ui";

/** Masked card details we surface on the receipt — never the PAN. */
export interface TokenizedCard {
  token: string;
  last4: string | null;
  brand: string | null;
}

export function formatMoney(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

// --- Collect.js loader (NMI) -----------------------------------------------
// Collect.js may only be configured once per page load, so we keep the loader
// and the active token handler at module scope. The lightbox variant renders
// NMI's own hosted modal (no field iframes to re-mount), which plays nicely
// with React remounting between the Billing page and the Subscribe wizard.
let collectJsPromise: Promise<CollectJsApi> | null = null;
let activeHandler: ((card: TokenizedCard) => void) | null = null;

interface CollectJsApi {
  configure: (opts: Record<string, unknown>) => void;
  startPaymentRequest: () => void;
}

function loadCollectJs(tokenizationKey: string): Promise<CollectJsApi> {
  if (collectJsPromise) return collectJsPromise;
  collectJsPromise = new Promise((resolve, reject) => {
    const existing = (window as unknown as { CollectJS?: CollectJsApi }).CollectJS;
    const onReady = (C: CollectJsApi) => {
      C.configure({
        variant: "lightbox",
        callback: (resp: { token?: string; card?: { number?: string; type?: string } }) => {
          const digits = (resp.card?.number ?? "").replace(/\D/g, "");
          activeHandler?.({
            token: resp.token ?? "",
            last4: digits ? digits.slice(-4) : null,
            brand: resp.card?.type ?? null,
          });
        },
      });
      resolve(C);
    };
    if (existing) return onReady(existing);
    const s = document.createElement("script");
    s.src = "https://secure.nmi.com/token/Collect.js";
    s.async = true;
    s.setAttribute("data-tokenization-key", tokenizationKey);
    s.onload = () => {
      const C = (window as unknown as { CollectJS?: CollectJsApi }).CollectJS;
      if (C) onReady(C);
      else reject(new Error("Collect.js loaded but CollectJS global is missing"));
    };
    s.onerror = () => reject(new Error("Could not load Collect.js — check the tokenization key / network"));
    document.head.appendChild(s);
  });
  return collectJsPromise;
}

interface Props {
  config: BillingConfig;
  submitLabel: string;
  submitting: boolean;
  onToken: (card: TokenizedCard) => void;
}

/** Card entry that produces a single-use token. NMI Collect.js when a
 *  tokenization key is configured; otherwise a mock card form. */
export default function PaymentForm(props: Props) {
  const live = props.config.mode === "nmi" && !!props.config.tokenizationKey;
  return live ? <NmiLightbox {...props} /> : <MockCard {...props} />;
}

function Secured({ live }: { live: boolean }) {
  return (
    <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
      <Lock size={12} />
      {live
        ? "Card details are entered in NMI's secure window — they never touch this app."
        : "Mock gateway — no real card is processed. Use any test card number."}
    </div>
  );
}

function NmiLightbox({ config, submitLabel, submitting, onToken }: Props) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the latest onToken reachable from the module-scope callback.
  const handlerRef = useRef(onToken);
  handlerRef.current = onToken;

  useEffect(() => {
    let cancelled = false;
    loadCollectJs(config.tokenizationKey)
      .then(() => !cancelled && setReady(true))
      .catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [config.tokenizationKey]);

  const pay = () => {
    setError(null);
    activeHandler = (card) => handlerRef.current(card);
    const C = (window as unknown as { CollectJS?: CollectJsApi }).CollectJS;
    if (C?.startPaymentRequest) C.startPaymentRequest();
    else setError("Payment window is not ready yet — try again in a moment.");
  };

  return (
    <div>
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <ShieldCheck size={16} className="text-emerald-500" />
        A secure NMI window will open to collect your card.
      </div>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <Button className="mt-4 w-full" onClick={pay} disabled={!ready || submitting}>
        <CreditCard size={16} /> {submitting ? "Processing…" : submitLabel}
      </Button>
      <Secured live />
    </div>
  );
}

function brandOf(digits: string): string | null {
  if (/^4/.test(digits)) return "visa";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^5/.test(digits)) return "mastercard";
  if (/^6/.test(digits)) return "discover";
  return digits ? "card" : null;
}

function MockCard({ submitLabel, submitting, onToken }: Props) {
  const [number, setNumber] = useState("4111 1111 1111 1111");
  const [exp, setExp] = useState("12 / 29");
  const [cvv, setCvv] = useState("999");
  const [decline, setDecline] = useState(false);

  const submit = () => {
    const digits = number.replace(/\D/g, "");
    onToken({
      // A token the mock gateway declines when it contains "decline".
      token: `${decline ? "mock-decline" : "mock-ok"}-${Math.random().toString(36).slice(2)}`,
      last4: digits ? digits.slice(-4) : null,
      brand: brandOf(digits),
    });
  };

  return (
    <div className="space-y-3">
      <Field label="Card number">
        <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="4111 1111 1111 1111" inputMode="numeric" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Expiry">
          <Input value={exp} onChange={(e) => setExp(e.target.value)} placeholder="MM / YY" />
        </Field>
        <Field label="CVV">
          <Input value={cvv} onChange={(e) => setCvv(e.target.value)} placeholder="123" inputMode="numeric" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={decline} onChange={(e) => setDecline(e.target.checked)} className="rounded border-slate-300" />
        Simulate a declined card
      </label>
      <Button className={cx("w-full")} onClick={submit} disabled={submitting}>
        <CreditCard size={16} /> {submitting ? "Processing…" : submitLabel}
      </Button>
      <Secured live={false} />
    </div>
  );
}
