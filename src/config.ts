/** Runtime settings, read from the environment once at start-up. */
export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
}

/** Validate and return configuration; fails fast on missing or weak values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  const jwtSecret = env.JWT_SECRET;
  if (!databaseUrl) throw new Error("DATABASE_URL is required (connect as app_user, not a superuser)");
  if (!jwtSecret || jwtSecret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be a valid port");
  return { databaseUrl, jwtSecret, port };
}
