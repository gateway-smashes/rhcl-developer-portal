# Architecture — Developer Portal

## 1. Overview

The portal is a classic SPA + API backend, with a single seam to the cluster:

```
┌─────────────────────────┐      REST / JSON (+ Bearer JWT)      ┌──────────────────────────────┐
│ Frontend (React/Vite)   │ ───────────────────────────────────▶│ Backend (Quarkus)            │
│  PatternFly-free, modern│                                      │  CatalogResource / MeResource │
│  Tailwind + TanStack Q  │◀─────────────────────────────────── │  AdminResource                │
│  OIDC (react-oidc-ctx)  │            JSON DTOs                  │  SubscriptionService          │
└─────────────────────────┘                                      │  RhclIntegrationService ◀──┐  │
                                                                  └────────────┬───────────────┘  │
                                                  ┌──────────────────┐         │                  │
                                                  │ PostgreSQL        │◀────────┘  (portal state)  │
                                                  └──────────────────┘                            │
                                                  ┌───────────────────────────────────────────────┘
                                                  ▼
                              RHCL / Kuadrant: APIProduct · PlanPolicy · APIKey
                              + Authorino API-key Secret      + Prometheus (usage)
```

The frontend never talks to Kubernetes. The backend never leaks Kubernetes
types past `RhclIntegrationService`.

## 2. Domain model (PostgreSQL)

| Entity | Notes |
|---|---|
| `PortalUser` | local projection of the OIDC identity; provisioned just-in-time |
| `ApiProduct` | catalog entry; `rhclRef` links to the cluster `APIProduct` |
| `ApplicationPlan` | usage tier; `tier` matches the Authorino `plan-id` annotation |
| `Application` | technical consumer owned by a user |
| `Subscription` | request linking product+app+plan+user; `rhclApiKeyRef` → cluster `APIKey` |
| `ApiKey` | **hash + masked preview only**; `secretRef` → Authorino Secret |
| `UsageMetric` | time-bucketed samples (mock-seeded or Prometheus-derived) |
| `AuditEvent` | append-only log of key lifecycle actions |

Plaintext keys are never persisted: only `SHA-256(key)` and a masked preview.

## 3. End-to-end flow (spec §8)

1. **Login** — OIDC against Keycloak realm `rhcl`; backend validates the bearer.
2. **Browse** — `GET /api/catalog/apis` (seeded from `banking-api` + plans).
3. **Docs** — Scalar renders the OpenAPI spec proxied by
   `GET /api/catalog/apis/{id}/openapi`.
4. **Create Application** — `POST /api/me/applications`.
5. **Subscribe** — `POST /api/me/subscriptions` creates a `Subscription`
   (PENDING). Auto-approves when the product is `AUTOMATIC` and the plan needs
   no approval.
6. **Approve** — admin calls `POST /api/admin/subscriptions/{id}/approve`;
   `SubscriptionService` calls `RhclIntegrationService.provisionApiKey` →
   creates the `APIKey` CR + Authorino `Secret`, applies the plan, and returns
   the **one-time plaintext** key.
7. **Use** — the consumer copies the key (shown once) and calls the gateway with
   the `api-key` header; rotation via `POST /api/me/subscriptions/{id}/rotate-key`.
8. **Monitor** — `GET /api/me/usage` → dashboard cards + charts.

## 4. RHCL resource mapping

| Portal concept | RHCL/Kuadrant resource |
|---|---|
| Catalog entry | `APIProduct` (`devportal.kuadrant.io/v1alpha1`) |
| Plan / tier | `PlanPolicy` (`extensions.kuadrant.io/v1alpha1`) → matched by `secret.kuadrant.io/plan-id` |
| Subscription request | portal-DB `Subscription` (no CR; approval happens in the portal) |
| Approved key | Authorino `Secret` (`app=banking-api-apikey`, `authorino.kuadrant.io/managed-by=authorino`) — the label is the activation gate — plus a non-reconciled `APIKey` CR for traceability |
| Auth scheme / hostname | `APIProduct.status.discoveredAuthScheme` / `APIKey.status.apiHostname` |
| Usage | Prometheus (Envoy + Limitador metrics); per-consumer attribution via `TelemetryPolicy` (`extensions.kuadrant.io/v1alpha1`, see `deploy/telemetry-policy.yaml`) |

## 5. Security (spec §9)

- OIDC bearer auth; `/api/me/*` and `/api/admin/*` require authentication (prod).
- Role checks on admin/owner actions via the authenticated identity.
- API keys stored as hash + preview; full value revealed once at creation.
- Every create/approve/rotate/revoke writes an `AuditEvent`.
- CORS restricted via `CORS_ORIGINS` in real deployments.

## 6. Observability (spec §10)

- `/q/health` (live/ready, incl. an RHCL-backend readiness check).
- `/q/metrics` Prometheus, with the mandated counters: `portal_subscriptions_created_total`,
  `portal_api_keys_created_total`, `portal_api_keys_rotated_total`,
  `portal_api_key_revoked_total`, `portal_subscription_approvals_total`,
  `portal_errors_total`.

## 7. Extensibility

- New integration backends implement `RhclIntegrationService` and are selected
  by `portal.rhcl.mode`.
- The catalog is DB-backed; a sync job can populate it from cluster
  `APIProduct`s (the `rhclRef` field is reserved for that link).
- The frontend is config-driven at runtime (`config.js`), so one image runs in
  any environment.
