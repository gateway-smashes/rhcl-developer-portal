# RHCL Developer Example

A sample developer portal for APIs governed by [Red Hat Connectivity
Link](https://www.redhat.com/en/technologies/cloud-computing/openshift/connectivity-link)
(downstream of the upstream [Kuadrant](https://kuadrant.io) project).

An external developer portal allows you to share your APIs with customers and partners.

Lets API consumers **browse** APIs (with auth, plans and OpenAPI docs),
**subscribe** to a plan, **get an API key**, and **see their usage** —
without giving any of them direct access to the cluster. Lets API owners
and platform admins **publish** new APIs and **approve** subscription
requests.

```
            ┌───────────────┐         ┌──────────────────────┐
   browser ─┤ frontend SPA  │  ───►   │  Quarkus backend     │
            │ (React + Vite)│         │  (JAX-RS + Hibernate)│
            └───────┬───────┘         └──────────┬───────────┘
                    │                            │
                    │ OIDC (Keycloak / RHBK)     │ RHCL CRDs
                    │                            │ APIProduct, APIKey, PlanPolicy
                    │                            │ + Authorino Secret (key gate)
                    ▼                            ▼
            ┌───────────────┐         ┌──────────────────────┐
            │  Keycloak     │         │  OpenShift           │
            │  (realm.users)│         │  + RHCL operator     │
            └───────────────┘         └──────────────────────┘
```

The backend reconciles its catalogue from the RHCL `APIProduct` CRs on
the cluster and, when an admin approves a subscription, provisions an
Authorino-managed API-key `Secret` — its
`authorino.kuadrant.io/managed-by=authorino` label is the activation
gate — plus a non-reconciled `APIKey` CR for traceability. Read more in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Screenshots

| | |
|---|---|
| ![Home](docs/images/01%20-%20Home.png) | ![Products](docs/images/02%20-%20Products.png) |
| **Home** — public landing with tenant branding and featured APIs. | **Products** — catalogue browse with REST / MCP protocol filter. |
| ![Products create](docs/images/02%20-%20Products%20create.png) | ![Products create 2](docs/images/02%20-%20Products%20create%202.png) |
| **Publish (api-owner)** — register an APIProduct with tags, contact and OpenAPI link. | **Publish — protocol & approval** — choose REST/MCP, set manual or automatic approval. |
| ![Plans](docs/images/03%20-%20Plans.png) | ![Subscription](docs/images/04%20-%20Subscription.png) |
| **Plans** — per-product tiers with their rate-limit windows and quotas. | **Subscription** — consumer picks a plan, gets an API key (one-shot reveal). |
| ![Analytics](docs/images/05%20-%20Analytics.png) | ![Docs](docs/images/06%20-%20Docs.png) |
| **Analytics** — aggregate across products by default, drill into a single one for quota. | **Documentation** — embedded Swagger UI / OpenAPI viewer per product. |

## Status

Pre-1.0. Production usage expects you to configure your own identity
provider, persist Postgres on a real volume, and pin image tags rather
than `:latest`.

## Quickstart (lab cluster, 5 minutes)

Prerequisites:
- OpenShift 4.18+ cluster you can `oc` into as `cluster-admin`
- RHCL operator installed (`oc get crd apiproducts.devportal.kuadrant.io`)
- Keycloak / Red Hat build of Keycloak installed with a realm (default
  realm name: `rhcl`)
- A test API already exposed as an `APIProduct` + `HTTPRoute` (the
  upstream demo uses `banking-api` in `rhcl-apps`, but any APIProduct
  will work — override `APIPRODUCT_NAME=`)

Deploy:

```bash
git clone https://github.com/<your-org>/rhcl-developer-portal.git
cd rhcl-developer-portal

# Brand it for your tenant (optional — defaults to "ACME Corp"):
export TENANT_NAME="My Bank"
export TENANT_DESCRIPTION="Our API platform"

./deploy/deploy.sh                  # builds backend+frontend in-cluster, applies stack
./deploy/setup-keycloak.sh          # creates the OIDC client + realm roles
```

That's it. The script auto-discovers cluster apps domain, Keycloak host,
gateway HTTPRoute, and prints the portal URL:

```
   Portal:  https://devportal.apps.<your-cluster>
```

For role mapping (`alice` → `api-admin`, `bob,carol` → `api-consumer`):

```bash
./deploy/setup-keycloak.sh --admin-user=alice --consumer-users=bob,carol
```

## Configuration reference

All knobs are env-vars. Passing nothing yields a working demo with
`ACME Corp` branding pointing at a stock `banking-api` APIProduct.

### `deploy/deploy.sh`

| Var | Default | Notes |
|---|---|---|
| `PORTAL_NAMESPACE` | `rhcl-devportal` | Where the portal lives. |
| `APPS_DOMAIN` | discovered from `ingresses.config/cluster` | `*.apps.<cluster>` wildcard. |
| `KEYCLOAK_NS` | `rhcl-keycloak` | Namespace holding the Keycloak Route. |
| `KEYCLOAK_HOST` | discovered from the Route | OIDC host. |
| `OIDC_REALM` | `rhcl` | Keycloak realm name. |
| `OIDC_ISSUER` | `https://$KEYCLOAK_HOST/realms/$OIDC_REALM` | Override if not stock. |
| `RHCL_NAMESPACE` | `rhcl-apps` | Where your APIProducts + HTTPRoutes live. |
| `APIPRODUCT_NAME` | `banking-api` | Demo APIProduct the backend seeds metadata for. |
| `GATEWAY_HOSTROUTE_NAME` | `${APIPRODUCT_NAME}-connectivity` | HTTPRoute holding the public hostname. |
| `GATEWAY_HOST` | discovered from that HTTPRoute | Gateway public hostname. |
| `BACKEND_HOST` | `portal-backend-$NS.$APPS_DOMAIN` | Portal API hostname. |
| `TENANT_NAME` | `ACME Corp` | Shown in header, hero, login. |
| `TENANT_DESCRIPTION` | `APIs and developer tooling` | Shown next to tenant on login. |

### Backend (`application.properties` / env)

| Var | Default | Notes |
|---|---|---|
| `QUARKUS_OIDC_AUTH_SERVER_URL` | (set by deploy.sh) | Keycloak realm issuer. |
| `OIDC_AUTH_SERVER_URL` | (same) | Frontend redirect uses this too. |
| `RHCL_DEFAULT_HOSTNAME` | (set by deploy.sh) | Used to compute API key example URLs. |
| `PORTAL_SEED_HOSTNAME` | `banking-api-connectivity.apps.example.com` | Initial APIProduct seed hostname. |
| `PORTAL_SEED_OPENAPI_URL` | `http://banking-api-v1.rhcl-apps.svc:8080/q/openapi` | OpenAPI spec proxied to the catalogue. |
| `PORTAL_RHCL_NAMESPACE` | `rhcl-apps` | Namespace where RHCL `APIProduct` / `APIKey` CRs are written. |
| `PORTAL_RHCL_APIKEYEMITSECRETREF` | `false` | Emit `spec.secretRef` on `APIKey` CRs. **Required for Kuadrant 1.4+**, rejected by 1.3 (the field is not declared in the v1alpha1 schema). Leave `false` on the pinned 1.3.x line; set `true` once the cluster moves to 1.4. |
| `DB_URL` / `DB_USER` / `DB_PASSWORD` | (Postgres deploy) | Portal metadata store. |

### Frontend (runtime, injected by entrypoint)

| Env | What renders | Default |
|---|---|---|
| `PORTAL_TENANT_NAME` | header brand · hero copy · login | `ACME Corp` |
| `PORTAL_TENANT_DESCRIPTION` | login subtitle | `APIs and developer tooling` |
| `API_BASE_URL` | base for `/api/*` calls | (required, set by deploy.sh) |
| `OIDC_AUTHORITY` | OIDC issuer | (required) |
| `OIDC_CLIENT_ID` | OIDC client id | `developer-portal` |

The entrypoint script rewrites `/config.js` on every start so the **same
image** works for every customer — no rebuild for rebrand.

## Roles

| Role | Sees | Can do |
|---|---|---|
| Anonymous | Home, Products, Documentation | Browse the public catalogue. |
| `api-consumer` | + Applications, Analytics, Settings | Create applications, subscribe to APIs, see own usage. |
| `api-owner` | + Admin section | Publish/edit APIProducts. |
| `api-admin` | full | Approve/reject subscription requests, manage plans. |

Roles are Keycloak realm roles; map them via the Keycloak UI or
`setup-keycloak.sh --admin-user= --consumer-users=`.

## Development

Backend (Quarkus, Java 21):

```bash
cd backend
./mvnw quarkus:dev          # localhost:8080, OIDC disabled, in-memory mode
```

Frontend (Vite + React 18):

```bash
cd frontend
npm install
npm run dev                 # localhost:5173, talks to backend on :8080
```

End-to-end against a real cluster: see `deploy/deploy.sh` — it builds
both images via OpenShift `BuildConfig` (binary strategy), so no local
Docker is required.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — backend domain model, RHCL
  integration, sync loops, security model.
- [CONTRIBUTING.md](CONTRIBUTING.md) — coding conventions, PR
  expectations, how to file a bug.

## License

[Apache License 2.0](LICENSE). Not affiliated with Red Hat — this is a
community implementation against the public RHCL/Kuadrant APIs.
