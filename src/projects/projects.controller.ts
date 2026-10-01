import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";

import { CurrentTenant, TenantGuard } from "../auth/tenant.guard.js";
import type { TenantClaims } from "../auth/tenant-token.js";
import { type Project, ProjectsService } from "./projects.service.js";

/** Validates a create request body. */
function parseName(body: unknown): string {
  const name = (body as { name?: unknown } | undefined)?.name;
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) {
    throw new BadRequestException("name must be a string of 1 to 100 characters");
  }
  return name.trim();
}

/** /projects: every route requires a valid tenant token. */
@Controller("projects")
@UseGuards(TenantGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /** List the caller's projects. */
  @Get()
  list(@CurrentTenant() tenant: TenantClaims): Promise<Project[]> {
    return this.projects.list(tenant.tenantId);
  }

  /** Get one project; another tenant's id looks exactly like a missing one. */
  @Get(":id")
  async get(@CurrentTenant() tenant: TenantClaims, @Param("id") id: string): Promise<Project> {
    const project = await this.projects.get(tenant.tenantId, id);
    if (!project) throw new NotFoundException();
    return project;
  }

  /** Create a project for the caller's tenant. */
  @Post()
  @HttpCode(201)
  create(@CurrentTenant() tenant: TenantClaims, @Body() body: unknown): Promise<Project> {
    return this.projects.create(tenant.tenantId, parseName(body));
  }
}
