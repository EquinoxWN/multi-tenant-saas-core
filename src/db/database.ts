import { Inject, Injectable } from "@nestjs/common";
import type pg from "pg";

export const PG_POOL = Symbol("PG_POOL");

/** Pool settings for the API: a dead or slow database fails a request instead of hanging it. */
export function poolConfig(connectionString: string): pg.PoolConfig {
  return {
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000, // waiting for a pooled or new connection
    statement_timeout: 10_000, // enforced by the server per statement
    query_timeout: 15_000, // client-side backstop if the server never answers
    idle_in_transaction_session_timeout: 15_000,
  };
}

/** Anything that can run a parameterised query. */
export type Queryable = Pick<pg.PoolClient, "query">;

/** Run fn in a transaction whose tenant is set, so RLS filters every statement inside it. */
export async function withTenant<T>(pool: pg.Pool, tenantId: string, fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    // is_local = true: the setting dies with the transaction, so a pooled connection can never
    // carry one tenant's context into another tenant's request.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // The connection's state is unknown: destroy it instead of returning it to the pool.
      broken = rollbackErr as Error;
    }
    throw err;
  } finally {
    client.release(broken);
  }
}

/** Nest-injectable wrapper around the pool. */
@Injectable()
export class Database {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /** Run fn inside a tenant-scoped transaction. */
  withTenant<T>(tenantId: string, fn: (db: Queryable) => Promise<T>): Promise<T> {
    return withTenant(this.pool, tenantId, fn);
  }
}
