import { Inject, Injectable } from "@nestjs/common";
import type pg from "pg";

export const PG_POOL = Symbol("PG_POOL");

/** Anything that can run a parameterised query. */
export type Queryable = Pick<pg.PoolClient, "query">;

/** Run fn in a transaction whose tenant is set, so RLS filters every statement inside it. */
export async function withTenant<T>(pool: pg.Pool, tenantId: string, fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // is_local = true: the setting dies with the transaction, so a pooled connection can never
    // carry one tenant's context into another tenant's request.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
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
