import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

import { type TenantClaims, verifyTenantToken } from "./tenant-token.js";

export const JWT_SECRET = Symbol("JWT_SECRET");

type TenantRequest = Request & { tenant?: TenantClaims };

/** Rejects requests without a valid bearer token and attaches the caller's tenant. */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(JWT_SECRET) private readonly secret: string) {}

  /** Allow the request only when its token verifies. */
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("missing bearer token");
    try {
      req.tenant = verifyTenantToken(header.slice("Bearer ".length), this.secret);
    } catch {
      // Same response for every failure, so attackers learn nothing about why.
      throw new UnauthorizedException("invalid token");
    }
    return true;
  }
}

/** Injects the verified tenant claims into a route handler. */
export const CurrentTenant = createParamDecorator((_: unknown, context: ExecutionContext): TenantClaims => {
  const tenant = context.switchToHttp().getRequest<TenantRequest>().tenant;
  if (!tenant) throw new UnauthorizedException();
  return tenant;
});
