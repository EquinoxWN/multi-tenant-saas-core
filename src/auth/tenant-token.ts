import jwt from "jsonwebtoken";

/** The caller identity carried by a verified token. */
export interface TenantClaims {
  tenantId: string;
  userId: string;
}

/** Raised for any token that must not be trusted. */
export class InvalidTokenError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Report whether value is a canonical UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Verify an HS256 token and extract its tenant and user; anything else is rejected. */
export function verifyTenantToken(token: string, secret: string): TenantClaims {
  let payload: string | jwt.JwtPayload;
  try {
    // Pinning the algorithm blocks "alg: none" and algorithm-confusion attacks.
    payload = jwt.verify(token, secret, { algorithms: ["HS256"], clockTolerance: 5 });
  } catch (err) {
    throw new InvalidTokenError(`token rejected: ${(err as Error).message}`);
  }
  if (typeof payload !== "object") throw new InvalidTokenError("token payload must be an object");
  const { tid, sub } = payload as { tid?: unknown; sub?: unknown };
  if (!isUuid(tid)) throw new InvalidTokenError("token has no valid tenant id (tid)");
  if (typeof sub !== "string" || sub.length === 0) throw new InvalidTokenError("token has no subject");
  return { tenantId: tid.toLowerCase(), userId: sub };
}

/** Issue a short-lived token; used by tests and local development. */
export function signTenantToken(claims: TenantClaims, secret: string, expiresInSeconds = 900): string {
  return jwt.sign({ tid: claims.tenantId }, secret, {
    algorithm: "HS256",
    subject: claims.userId,
    expiresIn: expiresInSeconds,
  });
}
