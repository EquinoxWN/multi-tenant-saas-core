# RFC 0001: multi-tenant-saas-core design

- **Status:** Accepted (M1 implemented)
- **Author:** EquinoxWN
- **Created:** 2026

## Problem

In a shared-database SaaS, every query must remember `WHERE tenant_id = ?`. One forgotten clause,
one IDOR on an id parameter, or one ORM default, and a customer sees another customer's data,
which is the most damaging bug a B2B product can ship. Code review alone does not scale to
hundreds of queries. Isolation has to be enforced below the application, and proven by tests
that actively try to break in.

## Goals

- **M1:** tenant resolved only from a verified token; tenant set per transaction on the database
  session; PostgreSQL row-level security on every table, so even a buggy query cannot cross
  tenants; tests against a real Postgres.
- **M2:** CI check that every table has a policy; large tenants moved to a dedicated schema or
  database without code changes.
- **M3:** per-tenant quotas and fair queuing, usage metering, a full attack suite, and a
  noisy-neighbour load test.

## Non-goals

- Authentication itself (login, SSO). The API trusts HS256 tokens from an identity provider.
- Horizontal sharding of one tenant (that is `zero-downtime-resharding`).
- Running as a hosted production service.

## Proposed design

![architecture](../architecture.png)

```
HTTP request ─► TenantGuard: verify JWT (HS256 only) ─► tid claim (UUID)
                      │
                      ▼
ProjectsService ─► withTenant(tid): BEGIN; set_config('app.tenant_id', tid, true); query; COMMIT
                      │
                      ▼
PostgreSQL (as app_user: NOSUPERUSER, NOBYPASSRLS)
  projects  ENABLE + FORCE RLS  USING / WITH CHECK (tenant_id = app_current_tenant())
  tenants   ENABLE + FORCE RLS  USING (id = app_current_tenant())
```

- **Identity:** `verifyTenantToken` pins the algorithm to HS256 and requires a UUID `tid` and a
  `sub`. The request body and URL can never choose the tenant.
- **Tenant context:** transaction-local, so pooled connections cannot leak it (ADR 0002).
- **Policies:** `app_current_tenant()` returns `NULL` when unset, so a missing context fails
  closed. `WITH CHECK` stops writes that would land in another tenant.
- **API:** NestJS 12 (ESM). `GET /projects`, `GET /projects/:id` (another tenant's id returns
  404, indistinguishable from a missing one), `POST /projects`.
- **Tests:** `embedded-postgres` starts a real PostgreSQL from `node_modules`, so the RLS tests
  run the same way on a laptop and in CI, with no Docker.

## Alternatives considered

| Option | Why not (yet) |
|---|---|
| Filter in the application (`WHERE tenant_id = ?` everywhere) | One missed clause leaks data; nothing enforces it. RLS makes the database refuse instead. |
| Schema per tenant | Strong isolation, but migrations multiply by tenant count. Kept for large tenants only (M2 "dedicated tier"). |
| Database per tenant | Strongest isolation, highest cost and operational load; wrong default for many small tenants. |
| Session-level `SET app.tenant_id` | Survives on pooled connections and leaks into the next request. Transaction-local `set_config` avoids that. |
| pg-mem or SQLite for tests | Neither implements PostgreSQL RLS, so tests would prove nothing. |
| Testcontainers | Needs Docker; `embedded-postgres` gives the same real server without it. |

## Measurement plan

- M1: number of cross-tenant attempts that succeed (target 0) across RLS, HTTP and token tests.
- M3: attack-suite results (IDOR, forged tenant ids, raw SQL) and a noisy-neighbour chart:
  p99 latency of a small tenant while a large tenant saturates its quota.

## Milestones

- **M1 (done):** token verification, tenant guard, transaction-local context, RLS on all tables,
  29 tests against real PostgreSQL.
- **M2:** policy-coverage CI check, dedicated schema or database per large tenant.
- **M3:** quotas, fair queuing, usage metering, attack suite, noisy-neighbour load test.

## Risks and open questions

- SQL running as `app_user` could change `app.tenant_id` itself, so SQL injection would defeat
  RLS. Mitigated by parameterised queries only; a signed tenant context is the M3 option.
- Every request opens a transaction; for very chatty endpoints the extra round trip matters.
- A new table without a policy is readable by every tenant until the M2 CI check exists.
