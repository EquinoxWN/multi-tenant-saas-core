# multi-tenant-saas-core

[![ci](https://github.com/EquinoxWN/multi-tenant-saas-core/actions/workflows/ci.yml/badge.svg)](https://github.com/EquinoxWN/multi-tenant-saas-core/actions/workflows/ci.yml)
![status](https://img.shields.io/badge/status-M1%20done%2C%20M2%20in%20progress-yellow)

> One customer must never see another's data: multi-tenant isolation with a test suite that actively tries to break in.

Part of my **Backend and API** list · TypeScript · core project

## Proof it works

29 tests against a real PostgreSQL: one tenant can never read, insert, move, update or delete another tenant's rows, even through a deliberately buggy query or a reused pooled connection; the HTTP API answers 404 for another tenant's project ids; forged, expired, `alg:none` and HS512 tokens are refused. npm audit finds no vulnerabilities:

![npm test against embedded PostgreSQL and npm audit](docs/proof/tests.jpg)

## Architecture

**Request flow:**

```mermaid
sequenceDiagram
  participant C as Client
  participant G as TenantGuard
  participant S as ProjectsService
  participant DB as PostgreSQL (as app_user)
  C->>G: request + Bearer JWT
  G->>G: verify HS256 only, tenant id must be a UUID
  G-->>C: 401 if missing, forged or expired
  G->>S: tenant from the token (never from the body)
  S->>DB: BEGIN, set_config('app.tenant_id', tenant, true)
  S->>DB: parameterised query
  DB->>DB: FORCE row-level security filters by tenant
  DB-->>S: only this tenant's rows
  S->>DB: COMMIT (tenant setting cleared)
  S-->>C: 200 / 201, or 404 for another tenant's id
```

**Full roadmap (M1 to M3):**

![architecture mindmap](docs/architecture.png)

## How it works

_Steps 1, 2 and 6 are built and tested; the rest is on the [roadmap](#roadmap)._

1. Each request resolves the tenant from its token and sets it for the current transaction only (`set_config('app.tenant_id', ..., true)`).
2. Row-level security policies on every table filter by that setting, so even a buggy query cannot read another tenant's rows.
3. The app connects as a role that cannot bypass RLS, and a CI check fails if any table lacks a policy.
4. Large tenants can move to a dedicated schema or database without code changes.
5. Per-tenant quotas and fair queuing stop one tenant starving others; usage is metered for billing.
6. An attack suite tries IDOR, forged tenant IDs and raw SQL to cross tenants, and every attempt must fail.

## Tech stack

| Area | In M1 | Planned |
|---|---|---|
| Core | TypeScript, NestJS, PostgreSQL row-level security, HS256 JWT | - |
| Fairness | - | Per-tenant quotas and rate limits in Valkey, usage metering |
| Test | Cross-tenant attack tests against a real PostgreSQL (embedded-postgres) | pgTAP policy tests, CI check that every table has a policy |

Language: **TypeScript** (NestJS 12, ESM) on **PostgreSQL** with row-level security.

| Path | What it is |
|---|---|
| `migrations/001_tenants_projects.sql` | Tables, `app_user` role (no RLS bypass), `ENABLE` + `FORCE` RLS policies |
| `src/auth/tenant-token.ts` | HS256-only JWT verification; tenant id must be a UUID |
| `src/auth/tenant.guard.ts` | Rejects requests without a valid token; injects the caller's tenant |
| `src/db/database.ts` | `withTenant()`: transaction-local `set_config('app.tenant_id', ...)` |
| `src/projects/` | `GET /projects`, `GET /projects/:id`, `POST /projects` |
| `test/` | Token, row-level-security and HTTP tests against a real PostgreSQL |

## Run it

Needs Node.js 24 or newer. No Docker: the tests start a real PostgreSQL from `node_modules` (`embedded-postgres`), with its data in the git-ignored `.tmp/`.

```bash
make setup   # npm ci
make lint    # TypeScript strict type check
make test    # 29 tests: tokens, row-level security, HTTP API
```

Run against your own PostgreSQL instead:

```bash
export TEST_DATABASE_URL=postgres://postgres:secret@localhost:5432/postgres   # tests
export DATABASE_ADMIN_URL=postgres://postgres:secret@localhost:5432/app      # migrations
make migrate
# set a password for the app role, then start the API as that role:
#   ALTER ROLE app_user LOGIN PASSWORD '...';
export DATABASE_URL=postgres://app_user:...@localhost:5432/app
export JWT_SECRET=$(openssl rand -hex 32)
npm run build && npm start
```

## Tests and results

Latest local run against PostgreSQL 18.4 (full detail in [docs/results/m1.md](docs/results/m1.md)):

| Attack attempted | Attempts | Succeeded |
|---|---|---|
| Read another tenant's rows (direct query, WHERE clause, IDOR by id) | 3 | 0 |
| Write into or move rows to another tenant (INSERT, UPDATE, DELETE, body field) | 4 | 0 |
| Bypass RLS (no context, `row_security = off`, pooled-connection leak) | 3 | 0 |
| Forge or tamper with tokens | 8 | 0 |

| Check | Result |
|---|---|
| Test suite | 29 passed, 0 failed |
| App role | `NOSUPERUSER`, `NOBYPASSRLS` |
| TypeScript | `strict`, `noUncheckedIndexedAccess`, no errors |

Known limit (ADR 0002): RLS stops buggy queries, not SQL injection, so every query is parameterised.

### Test map

```mermaid
mindmap
  root((29 tests pass))
    Row-level security 12
      each tenant sees only its rows
      no context means no rows
      cannot insert or move rows across tenants
      cannot switch row security off
      no leak across pooled connections
    HTTP API 8
      IDOR returns 404
      body cannot choose the tenant
      missing or forged token returns 401
      invalid input returns 400
    Tokens 9
      alg none rejected
      HS512 rejected
      expired or tampered rejected
      non UUID tenant rejected
```

## Roadmap

**M1** (≈15 h)
- [x] Write `docs/rfc/0001-design.md`: problem, goals, non-goals, chosen design
- [x] Each request resolves the tenant from its token and sets it for the current transaction only (`set_config('app.tenant_id', ..., true)`).
- [x] Row-level security policies on every table filter by that setting, so even a buggy query cannot read another tenant's rows.

**M2** (≈20 h)
- [ ] The app connects as a role that cannot bypass RLS, and a CI check fails if any table lacks a policy.
- [ ] Large tenants can move to a dedicated schema or database without code changes.

**M3** (≈25 h)
- [ ] Per-tenant quotas and fair queuing stop one tenant starving others; usage is metered for billing.
- [x] An attack suite tries IDOR, forged tenant IDs and raw SQL to cross tenants, and every attempt must fail.
- [ ] Publish the proof below with real numbers

## Proof

What this repo must show before it counts as done:

- Attack-suite results and a noisy-neighbour load test chart.

| Result | Value |
|---|---|
| M3 proof above | Not measured yet (M3). Current M1 numbers: see [Tests and results](#tests-and-results). |

## Why it matters

- **Interview angle:** 'Design a multi-tenant SaaS with strong isolation'.
- **Upstream I'd like to contribute to:** NestJS or PostgreSQL row-security docs and tests.

## Design docs

- [RFC 0001: design](docs/rfc/0001-design.md)
- [ADR 0001: record architecture decisions](docs/adr/0001-record-architecture-decisions.md)
- [ADR 0002: tenant context is transaction-local, and RLS is forced on every table](docs/adr/0002-transaction-local-tenant-context.md)

## Scope

This is a learning and portfolio system, not a hosted production service. Everything runs locally.

## Security and contributing

- Every GitHub Action is pinned to a commit SHA; workflows run read-only, without persisted credentials.
- Dependabot proposes dependency and action updates weekly.
- TypeScript `strict` on every push; `npm audit --audit-level=high` (`make audit`) in CI. Latest local run: 0 vulnerabilities.
- Report vulnerabilities privately: see [SECURITY.md](SECURITY.md). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE](LICENSE).
