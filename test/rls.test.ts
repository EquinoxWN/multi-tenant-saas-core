import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { withTenant } from "../src/db/database.js";
import { startTestDb, type TestDb } from "./support/postgres.js";

let db: TestDb;

before(async () => {
  db = await startTestDb();
});

after(async () => {
  await db?.stop();
});

/** Names visible to a tenant through a deliberately unfiltered query. */
async function visibleNames(tenantId: string): Promise<string[]> {
  return withTenant(db.app, tenantId, async (q) =>
    (await q.query<{ name: string }>("SELECT name FROM projects ORDER BY name")).rows.map((r) => r.name),
  );
}

describe("row-level security", () => {
  test("each tenant sees only its own rows", async () => {
    assert.deepEqual(await visibleNames(db.tenantA), ["A-alpha", "A-beta"]);
    assert.deepEqual(await visibleNames(db.tenantB), ["B-secret"]);
  });

  test("a buggy query that names another tenant still returns nothing", async () => {
    const rows = await withTenant(db.app, db.tenantA, async (q) =>
      (await q.query("SELECT * FROM projects WHERE tenant_id = $1", [db.tenantB])).rows,
    );
    assert.equal(rows.length, 0);
  });

  test("no tenant context means no rows", async () => {
    const res = await db.app.query("SELECT count(*)::int AS n FROM projects");
    assert.equal(res.rows[0].n, 0);
  });

  test("an unknown tenant sees nothing", async () => {
    assert.deepEqual(await visibleNames(randomUUID()), []);
  });

  test("inserting a row for another tenant is refused", async () => {
    await assert.rejects(
      withTenant(db.app, db.tenantA, (q) => q.query("INSERT INTO projects (tenant_id, name) VALUES ($1, 'planted')", [db.tenantB])),
      /row-level security/,
    );
  });

  test("moving a row to another tenant is refused", async () => {
    await assert.rejects(
      withTenant(db.app, db.tenantA, (q) => q.query("UPDATE projects SET tenant_id = $1 WHERE name = 'A-alpha'", [db.tenantB])),
      /row-level security/,
    );
  });

  test("updates and deletes cannot reach another tenant's rows", async () => {
    const counts = await withTenant(db.app, db.tenantA, async (q) => ({
      updated: (await q.query("UPDATE projects SET name = 'pwned' WHERE name = 'B-secret'")).rowCount,
      deleted: (await q.query("DELETE FROM projects WHERE name = 'B-secret'")).rowCount,
    }));
    assert.deepEqual(counts, { updated: 0, deleted: 0 });
    assert.deepEqual(await visibleNames(db.tenantB), ["B-secret"]);
  });

  test("the tenants table only shows the caller's own tenant", async () => {
    const names = await withTenant(db.app, db.tenantA, async (q) =>
      (await q.query<{ name: string }>("SELECT name FROM tenants")).rows.map((r) => r.name),
    );
    assert.deepEqual(names, ["Tenant A"]);
  });

  test("the app role cannot switch row security off", async () => {
    await assert.rejects(
      withTenant(db.app, db.tenantA, async (q) => {
        await q.query("SET LOCAL row_security = off");
        return q.query("SELECT * FROM projects");
      }),
      /row-level security/,
    );
  });

  test("SQL-injection-shaped input is stored as data, not executed", async () => {
    const payload = "x'); DELETE FROM projects; SELECT set_config('app.tenant_id', '' , false); --";
    await withTenant(db.app, db.tenantA, (q) => q.query("INSERT INTO projects (tenant_id, name) VALUES ($1, $2)", [db.tenantA, payload]));
    assert.ok((await visibleNames(db.tenantA)).includes(payload));
    assert.deepEqual(await visibleNames(db.tenantB), ["B-secret"]);
  });

  test("tenant context does not leak to the next use of a pooled connection", async () => {
    await visibleNames(db.tenantA); // pool has one connection, so the next query reuses it
    const res = await db.app.query("SELECT current_setting('app.tenant_id', true) AS t, count(*)::int AS n FROM projects");
    assert.equal(res.rows[0].n, 0);
    assert.ok(!res.rows[0].t, "setting must be cleared when the transaction ends");
  });

  test("the app role is not allowed to bypass RLS", async () => {
    const res = await db.admin.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user'");
    assert.deepEqual(res.rows[0], { rolsuper: false, rolbypassrls: false });
  });
});
