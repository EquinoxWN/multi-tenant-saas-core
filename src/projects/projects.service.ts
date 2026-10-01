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

  /** Create a project owned by the tenant. */
  create(tenantId: string, name: string): Promise<Project> {
    return this.db.withTenant(tenantId, async (q) => {
      const res = await q.query<ProjectRow>(
        "INSERT INTO projects (tenant_id, name) VALUES ($1, $2) RETURNING id, name, created_at",
        [tenantId, name],
      );
      return toProject(res.rows[0]!);
    });
  }
}
