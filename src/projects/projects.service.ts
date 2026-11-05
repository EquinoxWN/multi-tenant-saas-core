import { Injectable } from "@nestjs/common";

import { isUuid } from "../auth/tenant-token.js";
import { Database } from "../db/database.js";

/** A project as returned by the API. */
export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
  created_at: Date;
}

/** Maps a database row to the API shape. */
function toProject(row: ProjectRow): Project {
  return { id: row.id, name: row.name, createdAt: row.created_at.toISOString() };
}

/** Tenant-scoped project queries; isolation comes from RLS, not from WHERE clauses. */
@Injectable()
export class ProjectsService {
  constructor(private readonly db: Database) {}

  /** List the tenant's projects, oldest first. */
  list(tenantId: string): Promise<Project[]> {
    return this.db.withTenant(tenantId, async (q) => {
      const res = await q.query<ProjectRow>("SELECT id, name, created_at FROM projects ORDER BY created_at, id");
      return res.rows.map(toProject);
    });
  }

  /** Fetch one project, or null when it does not exist for this tenant. */
  get(tenantId: string, id: string): Promise<Project | null> {
    if (!isUuid(id)) return Promise.resolve(null);
    return this.db.withTenant(tenantId, async (q) => {
      const res = await q.query<ProjectRow>("SELECT id, name, created_at FROM projects WHERE id = $1", [id]);
      return res.rows[0] ? toProject(res.rows[0]) : null;
    });
  }

  /** Create a project owned by the tenant; a repeated idempotency key returns the first project. */
  create(tenantId: string, name: string, idempotencyKey?: string): Promise<Project> {
    return this.db.withTenant(tenantId, async (q) => {
      if (idempotencyKey === undefined) {
        const res = await q.query<ProjectRow>(
          "INSERT INTO projects (tenant_id, name) VALUES ($1, $2) RETURNING id, name, created_at",
          [tenantId, name],
        );
        return toProject(res.rows[0]!);
      }
      const inserted = await q.query<ProjectRow>(
        `INSERT INTO projects (tenant_id, name, idempotency_key) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING id, name, created_at`,
        [tenantId, name, idempotencyKey],
      );
      if (inserted.rows[0]) return toProject(inserted.rows[0]);
      // RLS limits this to the caller's tenant, so another tenant's key is never visible.
      const existing = await q.query<ProjectRow>(
        "SELECT id, name, created_at FROM projects WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      return toProject(existing.rows[0]!);
    });
  }
}
