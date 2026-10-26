# Billing with NMI — Developer Portal

**Status:** implemented on branch `billing` · **Gateway:** NMI (Network Merchants, Inc.) · **Mode:** mock by default, real NMI sandbox opt-in

This document summarizes the billing capability we added to the Developer Portal: what it does, how it is wired, how to run it, and what you need to test it against the real NMI gateway.

---

## 1. What it does

The portal now supports **paid API plans**. Each `ApplicationPlan` carries a monthly price; a plan with a price > 0 is a **paid plan**. Subscribing to a paid plan no longer activates instantly — the subscription is created in `PENDING` state and only activates (issuing the API key) **after a successful card charge** through NMI.

Seeded demo plans (banking-api):

| Plan   | Price        | Activation          |
|--------|--------------|---------------------|
| Bronze | **Free**     | instant             |
| Silver | **$49 / mo** | on successful charge |
| Gold   | **$199 / mo**| on successful charge |

Free plans keep the previous instant / auto-approve behaviour unchanged.

Two entry points, as requested:

- **Subscribe wizard** (`/products/:id/subscribe`) — a **Payment** step appears before the final "API Key" step whenever the chosen plan is paid. Pay → the subscription activates and the key is revealed.
- **Billing page** (`/billing`, new nav entry) — pay-to-activate any pending paid subscription, manage a saved card, run a recurring "charge this month", and see full payment history.

Card data is tokenized client-side by **NMI Collect.js** (a PCI-safe hosted window) — the card number never touches the portal. The backend only ever handles the opaque `payment_token` / `customer_vault_id` and the masked last-4.

---

## 2. How a charge flows

```
Browser (Collect.js lightbox)             Portal backend                 NMI
  └─ user enters card ─► payment_token
         │  POST /api/me/billing/charge
         │  { subscriptionId, payment_token }
         ▼
                               BillingService
                                 ├─ record Payment (PENDING)
                                 ├─ NmiClient.sale(amount, token) ──► transact.php  (type=sale)
                                 │                                    ◄── response=1/2/3
                                 ├─ stamp Payment (APPROVED/DECLINED/ERROR)
                                 └─ if APPROVED: SubscriptionService.activateAfterPayment()
                                        └─ provisions the RHCL API key (existing flow)
         ◄─ { payment, credential }        (credential present only on approval)
```

- **Customer Vault**: when the user opts to save the card, the backend adds it to the NMI Customer Vault (`customer_vault=add_customer`) and stores the returned `customer_vault_id`. Later "charge this month" calls run a sale against that vault id — no card re-entry.
- **Response mapping**: NMI returns a URL-encoded body; `response` `1`=approved, `2`=declined, `3`=error → our `PaymentStatus`.

---

## 3. What changed

### Backend (Quarkus)
| File | Purpose |
|------|---------|
| `domain/ApplicationPlan.java` | `priceCents` + `currency` + `isPaid()` |
| `domain/Payment.java` *(new)* | invoice-ledger line per charge (amount, status, NMI txn id, masked card) |
| `domain/PaymentMethod.java` *(new)* | saved card (NMI Customer Vault reference) |
| `domain/Enums.java` | `PaymentStatus`, `PaymentKind` |
| `service/NmiClient.java` *(new)* | Direct-Post client for `transact.php` (sale / sale-with-vault / add-to-vault); `mock` + `nmi` modes |
| `service/BillingService.java` *(new)* | orchestration: charge → ledger → activate subscription → vault management |
| `service/SubscriptionService.java` | paid plans do **not** auto-approve; `activateAfterPayment()` added |
| `api/BillingResource.java` *(new)* | `/api/me/billing` — `config`, state, `charge`, `methods`, `renew` |
| `api/Dtos.java` | plan price fields + billing DTOs |
| `service/DataSeeder.java` | plan prices (Bronze free / Silver $49 / Gold $199) |
| `resources/application.properties` | `portal.billing.*` config |

### Frontend (React / Vite)
| File | Purpose |
|------|---------|
| `components/PaymentForm.tsx` *(new)* | NMI Collect.js (lightbox) when configured, mock card form otherwise |
| `pages/Billing.tsx` *(new)* | billing dashboard (pay, saved card, recurring, history) |
| `pages/Subscribe.tsx` | Payment step for paid plans; prices on plan cards + review |
| `api/hooks.ts`, `api/types.ts` | billing hooks + types |
| `App.tsx`, `components/AppShell.tsx` | `/billing` route + nav entry |

No database migration is required — Hibernate (`generation=update`) adds the new columns/tables automatically.

---

## 4. Running it

### Mock mode (default — nothing external needed)
`portal.billing.mode=mock`. An in-process fake gateway **approves every charge** (and declines a token containing `"decline"`, which the mock card form can trigger with a checkbox). The entire flow — pay, activate, receipt, history, recurring — is fully demoable with **no NMI account**.

### Real NMI sandbox mode
Set these env vars on the backend deployment and restart:

```
BILLING_MODE=nmi
NMI_SECURITY_KEY=<your API-permission key>        # private, backend only
NMI_TOKENIZATION_KEY=<your Tokenization key>       # public, used by Collect.js
# optional: NMI_ENDPOINT=https://secure.nmi.com/api/transact.php
```

> ⚠️ **Important — there is no public demo key anymore.** NMI **retired** the old shared sandbox credentials that used to be printed in their docs (`6457Thfj…`); we verified live that every endpoint now rejects it with *"Specified API key not found"*. To test against the real gateway you must create **your own NMI (or reseller) account**, enable **Test Mode**, and generate a **paired** set of keys from the same gateway account:
> 1. An **API**-permission key → `NMI_SECURITY_KEY` (backend).
> 2. A **Tokenization**-permission key → `NMI_TOKENIZATION_KEY` (public, Collect.js).
>
> The two keys must belong to the **same account** or the token will be rejected at charge time. Mock mode needs none of this.

---

## 5. Testing

**Mock mode:** subscribe to Gold or Silver → the Payment step appears → "Pay & activate" → the key is revealed. Toggle "Simulate a declined card" to see the decline path. Visit `/billing` for history, saved card, and "charge this month".

**NMI Test Mode** (once your keys are set) — official test values:

| Card (Visa) | Expiry | CVV |
|-------------|--------|-----|
| `4111 1111 1111 1111` | any future `MM/YY` | `999` |

Test-mode triggers: **amount ≥ $1.00** on a valid card → approval; **amount < $1.00** → decline; invalid card → error. (Our seeded prices are all ≥ $1, so they approve.)

---

## 6. Notes & next steps

- **Security**: the PAN never reaches the portal (Collect.js tokenization). The backend stores only masked card data + opaque gateway references. The private API key is backend-only config; the tokenization key is public by design.
- **Not yet done** (candidates for a follow-up): automated recurring billing (a scheduler instead of the manual "charge this month" button), 3-D Secure, webhooks for async settlement, admin-side pricing UI, and invoices/PDF receipts.
- **Relationship to RHCL**: billing sits entirely in the portal — it gates the existing RHCL API-key provisioning (the subscription activates the same way as before, just after a payment instead of before).
