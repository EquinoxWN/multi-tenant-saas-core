import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import pg from "pg";

import { AppModule } from "./app.module.js";
import { loadConfig } from "./config.js";
import { poolConfig } from "./db/database.js";

/** Start the HTTP server. */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const pool = new pg.Pool(poolConfig(config.databaseUrl));
  const app = await NestFactory.create(AppModule.forRoot({ pool, jwtSecret: config.jwtSecret }));
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  await app.listen(config.port);
  console.log(`listening on :${config.port}`);
}

await bootstrap();
