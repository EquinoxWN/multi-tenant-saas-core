import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

import { migrate } from "../src/db/migrate.js";
import { startTestDb, type TestDb } from "./support/postgres.js";

let db: TestDb;

before(async () => {
  db = await startTestDb();
});

after(async () => {
  await db?.stop();
});

test("migrations already applied are skipped", async () => {
  const client = await db.admin.connect();
  try {
    assert.deepEqual(await migrate(client), []);
  } finally {
    client.release();
  }
});

test("two migrators started at once apply a new file exactly once", async () => {
  const dir = resolve(".tmp", `migrations-${process.pid}`);
  await mkdir(dir, { recursive: true });
  // Slow enough that both runners read schema_migrations before either commits, without the lock.
  await writeFile(`${dir}/900_probe.sql`, "SELECT pg_sleep(0.5); CREATE TABLE migrate_probe (id int);");
  const [a, b] = await Promise.all([db.admin.connect(), db.admin.connect()]);
  try {
    const results = await Promise.allSettled([migrate(a, dir), migrate(b, dir)]);
    assert.deepEqual(
      results.map((r) => r.status),
      ["fulfilled", "fulfilled"],
      JSON.stringify(results.map((r) => (r.status === "rejected" ? String(r.reason) : r.value))),
    );
    const applied = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    assert.deepEqual(applied, ["900_probe.sql"]);
  } finally {
    a.release();
    b.release();
  }
});
