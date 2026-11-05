import "reflect-metadata";

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../src/app.module.js";
import { signTenantToken } from "../src/auth/tenant-token.js";
import { startTestDb, type TestDb } from "./support/postgres.js";

const secret = randomBytes(32).toString("hex");
let db: TestDb;
let app: INestApplication;
let base: string;

before(async () => {
  db = await startTestDb();
  app = await NestFactory.create(AppModule.forRoot({ pool: db.app, jwtSecret: secret }), { logger: false });
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});

after(async () => {
  await app?.close();
  await db?.stop();
});

/** Call the API as a tenant (or anonymously when token is undefined). */
async function call(path: string, token?: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

const tokenFor = (tenantId: string): string => signTenantToken({ tenantId, userId: "user-1" }, secret);

describe("HTTP API", () => {
  test("lists only the caller's projects", async () => {
    const res = await call("/projects", tokenFor(db.tenantA));
    assert.equal(res.status, 200);
    const names = ((await res.json()) as { name: string }[]).map((p) => p.name).sort();
    assert.deepEqual(names, ["A-alpha", "A-beta"]);
  });

  test("creates a project owned by the caller", async () => {
    const res = await call("/projects", tokenFor(db.tenantB), { method: "POST", body: JSON.stringify({ name: "B-new" }) });
    assert.equal(res.status, 201);
    const listB = (await (await call("/projects", tokenFor(db.tenantB))).json()) as { name: string }[];
    const listA = (await (await call("/projects", tokenFor(db.tenantA))).json()) as { name: string }[];
    assert.ok(listB.some((p) => p.name === "B-new"));
    assert.ok(!listA.some((p) => p.name === "B-new"));
  });

  test("another tenant's project id returns 404, not the project (IDOR)", async () => {
    const { rows } = await db.admin.query<{ id: string }>("SELECT id FROM projects WHERE name = 'B-secret'");
    const res = await call(`/projects/${rows[0]!.id}`, tokenFor(db.tenantA));
    assert.equal(res.status, 404);
    const own = await call(`/projects/${rows[0]!.id}`, tokenFor(db.tenantB));
    assert.equal(own.status, 200);
  });

  test("a malformed id is a plain 404", async () => {
    assert.equal((await call("/projects/not-a-uuid", tokenFor(db.tenantA))).status, 404);
  });

  test("missing token is 401", async () => {
    assert.equal((await call("/projects")).status, 401);
  });

  test("a valid token under another auth scheme is 401", async () => {
    // "Digest " has the same length as "Bearer ", so only a real scheme check can reject it.
    const res = await fetch(`${base}/projects`, { headers: { Authorization: `Digest ${tokenFor(db.tenantA)}` } });
    assert.equal(res.status, 401);
  });

  test("token forged with another secret is 401", async () => {
    const forged = signTenantToken({ tenantId: db.tenantB, userId: "attacker" }, randomBytes(32).toString("hex"));
    assert.equal((await call("/projects", forged)).status, 401);
  });

  test("a body cannot choose the tenant", async () => {
    const res = await call("/projects", tokenFor(db.tenantA), {
      method: "POST",
      body: JSON.stringify({ name: "sneaky", tenant_id: db.tenantB, tenantId: db.tenantB }),
    });
    assert.equal(res.status, 201);
    const listB = (await (await call("/projects", tokenFor(db.tenantB))).json()) as { name: string }[];
    assert.ok(!listB.some((p) => p.name === "sneaky"));
  });

  test("a retried create with the same Idempotency-Key makes one project", async () => {
    const init = { method: "POST", body: JSON.stringify({ name: "A-retry" }), headers: { "Idempotency-Key": "req-123" } };
    const first = await call("/projects", tokenFor(db.tenantA), init);
    const again = await call("/projects", tokenFor(db.tenantA), init);
    assert.equal(first.status, 201);
    assert.equal(again.status, 201);
    assert.equal(((await again.json()) as { id: string }).id, ((await first.json()) as { id: string }).id);
    const { rows } = await db.admin.query("SELECT count(*)::int AS n FROM projects WHERE name = 'A-retry'");
    assert.equal(rows[0].n, 1);
  });

  test("the same Idempotency-Key in another tenant is a separate project", async () => {
    const init = { method: "POST", body: JSON.stringify({ name: "shared-key" }), headers: { "Idempotency-Key": "same" } };
    const a = (await (await call("/projects", tokenFor(db.tenantA), init)).json()) as { id: string };
    const b = (await (await call("/projects", tokenFor(db.tenantB), init)).json()) as { id: string };
    assert.notEqual(a.id, b.id);
    assert.equal((await call(`/projects/${a.id}`, tokenFor(db.tenantB))).status, 404);
  });

  test("creates without an Idempotency-Key are not deduplicated", async () => {
    for (let i = 0; i < 2; i++) {
      const res = await call("/projects", tokenFor(db.tenantA), { method: "POST", body: JSON.stringify({ name: "A-twice" }) });
      assert.equal(res.status, 201);
    }
    const { rows } = await db.admin.query("SELECT count(*)::int AS n FROM projects WHERE name = 'A-twice'");
    assert.equal(rows[0].n, 2);
  });

  test("an invalid Idempotency-Key is rejected with 400", async () => {
    for (const key of ["has space", "x".repeat(201)]) {
      const res = await call("/projects", tokenFor(db.tenantA), {
        method: "POST",
        body: JSON.stringify({ name: "A-badkey" }),
        headers: { "Idempotency-Key": key },
      });
      assert.equal(res.status, 400, key);
    }
  });

  test("invalid names are rejected with 400", async () => {
    for (const body of [{}, { name: "" }, { name: "x".repeat(101) }, { name: 42 }]) {
      const res = await call("/projects", tokenFor(db.tenantA), { method: "POST", body: JSON.stringify(body) });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });
});
