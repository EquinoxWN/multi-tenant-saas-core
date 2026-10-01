import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";

import pg from "pg";

import { migrate } from "../../src/db/migrate.js";

/** A migrated database with an admin pool and a pool connected as the RLS-bound app_user. */
export interface TestDb {
  admin: pg.Pool;
  app: pg.Pool;
  tenantA: string;
  tenantB: string;
  stop(): Promise<void>;
}

/** Ask the OS for a free TCP port. */
function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => ok(port));
    });
  });
}

/** Start Postgres (embedded, or TEST_DATABASE_URL if set), migrate it and seed two tenants. */
export async function startTestDb(): Promise<TestDb> {
  const password = randomBytes(16).toString("hex");
  let adminConfig: pg.PoolConfig;
  let stopServer = async (): Promise<void> => undefined;

  if (process.env.TEST_DATABASE_URL) {
    adminConfig = { connectionString: process.env.TEST_DATABASE_URL };
  } else {
    // Binaries come from node_modules; the data directory lives in the repo's git-ignored .tmp/.
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const port = await freePort();
    const server = new EmbeddedPostgres({
      databaseDir: resolve(".tmp", `pg-${randomBytes(4).toString("hex")}`),
      user: "postgres",
      password,
      port,
      persistent: false,
      onLog: () => undefined,
    });
    await server.initialise();
    await server.start();
    stopServer = () => server.stop();
    adminConfig = { host: "127.0.0.1", port, user: "postgres", password, database: "postgres" };
  }

  const admin = new pg.Pool({ ...adminConfig, max: 2 });
  const client = await admin.connect();
  try {
    await migrate(client);
    // Identifiers cannot be bound as parameters; format() with %L quotes the password safely.
    const alter = await client.query<{ sql: string }>("SELECT format('ALTER ROLE app_user LOGIN PASSWORD %L', $1::text) AS sql", [password]);
    await client.query(alter.rows[0]!.sql);
  } finally {
    client.release();
  }

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  // The admin (superuser) bypasses RLS, which is how the fixture seeds both tenants.
  await admin.query("INSERT INTO tenants (id, name) VALUES ($1, 'Tenant A'), ($2, 'Tenant B')", [tenantA, tenantB]);
  await admin.query(
    "INSERT INTO projects (tenant_id, name) VALUES ($1, 'A-alpha'), ($1, 'A-beta'), ($2, 'B-secret')",
    [tenantA, tenantB],
  );

  const url = new URL(process.env.TEST_DATABASE_URL ?? `postgres://127.0.0.1:${adminConfig.port}/postgres`);
  const app = new pg.Pool({
    host: adminConfig.host ?? url.hostname,
    port: Number(adminConfig.port ?? url.port ?? 5432),
    database: adminConfig.database ?? url.pathname.slice(1),
    user: "app_user",
    password,
    max: 1, // one connection makes "context leaks between requests" observable
  });

  return {
    admin,
    app,
    tenantA,
    tenantB,
    async stop() {
      await app.end();
      await admin.end();
      await stopServer();
    },
  };
}
