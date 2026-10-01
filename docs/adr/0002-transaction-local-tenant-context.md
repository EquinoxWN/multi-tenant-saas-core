# ADR 0002: Tenant context is transaction-local, and RLS is forced on every table

- **Status:** Accepted

## Context

Row-level security filters rows by `app_current_tenant()`, which reads the `app.tenant_id`
setting. Connections are pooled, so a setting made with a plain `SET` would stay on the
connection and the next request (possibly another tenant's) would inherit it. Also, by default
a table's owner bypasses its own RLS policies.

## Decision

- Every tenant-scoped query runs inside `withTenant()`: `BEGIN`, then
  `set_config('app.tenant_id', $1, true)` (transaction-local, parameterised), the queries, then
  `COMMIT` or `ROLLBACK`. The setting disappears when the transaction ends.
- An unset or empty setting maps to `NULL`, which matches no rows. Forgetting `withTenant()`
  returns nothing rather than everything.
- Tables use `ENABLE` **and** `FORCE ROW LEVEL SECURITY`, and the app connects as `app_user`,
  which is `NOSUPERUSER NOBYPASSRLS` and cannot turn `row_security` off.
- The tenant comes only from the verified token, never from the request body or URL.

## Consequences

- Each request pays for one extra round trip (`set_config`) and a short transaction.
- A connection can never leak one tenant's context to the next request; a test proves it with a
  one-connection pool.
- Known limit: SQL that runs as `app_user` can call `set_config` itself. RLS therefore protects
  against buggy queries, not against SQL injection. All queries are parameterised, and a test
  stores injection-shaped input as plain data. Signing the tenant context (for example an HMAC
  checked by a `SECURITY DEFINER` function) is the M3 hardening option.
