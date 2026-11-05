import assert from "node:assert/strict";
import { test } from "node:test";

import type pg from "pg";

import { poolConfig, withTenant } from "../src/db/database.js";

/** A pool whose single client fails the statements named in failOn and records release(). */
function fakePool(failOn: string[]): { pool: pg.Pool; released: unknown[]; sql: string[] } {
  const released: unknown[] = [];
  const sql: string[] = [];
  const client = {
    query: async (text: string) => {
      sql.push(text);
      if (failOn.some((f) => text.startsWith(f))) throw new Error(`${text} failed`);
      return { rows: [], rowCount: 0 };
    },
    release: (err?: unknown) => released.push(err),
  };
  return { pool: { connect: async () => client } as unknown as pg.Pool, released, sql };
}

test("a failed tenant transaction rolls back and returns the connection to the pool", async () => {
  const { pool, released, sql } = fakePool(["SELECT 1"]);
  await assert.rejects(withTenant(pool, "t", (q) => q.query("SELECT 1")), /SELECT 1 failed/);
  assert.ok(sql.includes("ROLLBACK"));
  assert.deepEqual(released, [undefined]);
});

test("a connection whose ROLLBACK fails is destroyed, not reused by the next tenant", async () => {
  const { pool, released } = fakePool(["SELECT 1", "ROLLBACK"]);
  // The caller still sees the original error, not the rollback's.
  await assert.rejects(withTenant(pool, "t", (q) => q.query("SELECT 1")), /SELECT 1 failed/);
  assert.equal(released.length, 1);
  assert.ok(released[0] instanceof Error, "release(err) tells pg to discard the client");
});

test("the API pool bounds connection waits and statements", () => {
  const cfg = poolConfig("postgres://app_user@db/app");
  assert.equal(cfg.connectionString, "postgres://app_user@db/app");
  for (const key of ["connectionTimeoutMillis", "statement_timeout", "query_timeout", "idle_in_transaction_session_timeout"] as const) {
    const v = cfg[key];
    assert.ok(typeof v === "number" && v > 0 && v <= 30_000, `${key} = ${String(v)}`);
  }
});
