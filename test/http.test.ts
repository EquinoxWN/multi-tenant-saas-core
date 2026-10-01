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

  test("invalid names are rejected with 400", async () => {
    for (const body of [{}, { name: "" }, { name: "x".repeat(101) }, { name: 42 }]) {
      const res = await call("/projects", tokenFor(db.tenantA), { method: "POST", body: JSON.stringify(body) });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });
});
