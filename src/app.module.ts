import { type DynamicModule, Module } from "@nestjs/common";
import type pg from "pg";

import { JWT_SECRET, TenantGuard } from "./auth/tenant.guard.js";
import { Database, PG_POOL } from "./db/database.js";
import { ProjectsController } from "./projects/projects.controller.js";
import { ProjectsService } from "./projects/projects.service.js";

/** Dependencies the module needs from its host (the server or a test). */
export interface AppModuleOptions {
  pool: pg.Pool;
  jwtSecret: string;
}

/** Root module; built with forRoot so tests can inject their own pool and secret. */
@Module({})
export class AppModule {
  /** Wire the module with a pool connected as app_user and the token secret. */
  static forRoot(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [ProjectsController],
      providers: [
        { provide: PG_POOL, useValue: options.pool },
        { provide: JWT_SECRET, useValue: options.jwtSecret },
        Database,
        ProjectsService,
        TenantGuard,
      ],
    };
  }
}
