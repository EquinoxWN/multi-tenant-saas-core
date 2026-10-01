import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";

import jwt from "jsonwebtoken";

import { InvalidTokenError, signTenantToken, verifyTenantToken } from "../src/auth/tenant-token.js";

const secret = randomBytes(32).toString("hex");
const tenantId = randomUUID();

test("valid token yields tenant and user", () => {
  const token = signTenantToken({ tenantId, userId: "user-1" }, secret);
  assert.deepEqual(verifyTenantToken(token, secret), { tenantId, userId: "user-1" });
});

test("token signed with another secret is rejected", () => {
  const token = signTenantToken({ tenantId, userId: "u" }, randomBytes(32).toString("hex"));
  assert.throws(() => verifyTenantToken(token, secret), InvalidTokenError);
});

test("expired token is rejected", () => {
  const token = jwt.sign({ tid: tenantId, exp: Math.floor(Date.now() / 1000) - 60 }, secret, { subject: "u" });
  assert.throws(() => verifyTenantToken(token, secret), InvalidTokenError);
});

test("unsigned alg:none token is rejected", () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ tid: tenantId, sub: "u" })).toString("base64url");
  assert.throws(() => verifyTenantToken(`${header}.${body}.`, secret), InvalidTokenError);
});

test("HS512 token is rejected because only HS256 is allowed", () => {
  const token = jwt.sign({ tid: tenantId }, secret, { algorithm: "HS512", subject: "u" });
  assert.throws(() => verifyTenantToken(token, secret), InvalidTokenError);
});

test("token without a tenant id is rejected", () => {
  const token = jwt.sign({}, secret, { subject: "u" });
  assert.throws(() => verifyTenantToken(token, secret), /tenant id/);
});

test("token with a non-UUID tenant id is rejected", () => {
  const token = jwt.sign({ tid: "' OR 1=1 --" }, secret, { subject: "u" });
  assert.throws(() => verifyTenantToken(token, secret), /tenant id/);
});

test("token without a subject is rejected", () => {
  const token = jwt.sign({ tid: tenantId }, secret);
  assert.throws(() => verifyTenantToken(token, secret), /subject/);
});

test("tampered payload is rejected", () => {
  const [h, , s] = signTenantToken({ tenantId, userId: "u" }, secret).split(".");
  const forged = Buffer.from(JSON.stringify({ tid: randomUUID(), sub: "u" })).toString("base64url");
  assert.throws(() => verifyTenantToken(`${h}.${forged}.${s}`, secret), InvalidTokenError);
});
