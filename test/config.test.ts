import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "../src/config.js";

const SECRET = "s".repeat(32);
const URL = "postgres://app_user@db/app";

test("valid settings load, with port 3000 by default", () => {
  assert.deepEqual(loadConfig({ DATABASE_URL: URL, JWT_SECRET: SECRET }), { databaseUrl: URL, jwtSecret: SECRET, port: 3000 });
  assert.equal(loadConfig({ DATABASE_URL: URL, JWT_SECRET: SECRET, PORT: "8080" }).port, 8080);
});

test("a missing database URL is refused", () => {
  assert.throws(() => loadConfig({ JWT_SECRET: SECRET }), /DATABASE_URL is required/);
});

test("a missing or short token secret is refused", () => {
  assert.throws(() => loadConfig({ DATABASE_URL: URL }), /JWT_SECRET must be at least 32/);
  assert.throws(() => loadConfig({ DATABASE_URL: URL, JWT_SECRET: "s".repeat(31) }), /JWT_SECRET must be at least 32/);
});

test("an invalid port is refused", () => {
  for (const PORT of ["65536", "-1", "abc", "80.5"]) {
    assert.throws(() => loadConfig({ DATABASE_URL: URL, JWT_SECRET: SECRET, PORT }), /PORT must be a valid port/, PORT);
  }
});
