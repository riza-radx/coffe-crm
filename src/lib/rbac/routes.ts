import type { Role } from "./types";

/** Reachable without a session. */
export const PUBLIC_PATHS = ["/login", "/invite"] as const;

/** Pages only a Super Admin may open. Data-level RBAC still applies inside them. */
const SUPER_ADMIN_ONLY = ["/users", "/settings", "/audit-logs"] as const;

/**
 * Accepts either a bare pathname (what the proxy passes) or a path with a query
 * string, so a caller that forgets to strip the query cannot accidentally widen
 * access.
 */
function normalize(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0];
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isPublicPath(pathname: string): boolean {
  const path = normalize(pathname);
  return PUBLIC_PATHS.some((p) => matches(path, p));
}

/**
 * Coarse, cookie-only page gating for the proxy. Deliberately role-based and
 * not resource-based — resource decisions belong in route handlers via can().
 */
export function canAccessPath(role: Role | null, pathname: string): boolean {
  const path = normalize(pathname);
  if (isPublicPath(path)) return true;
  if (!role) return false;
  if (SUPER_ADMIN_ONLY.some((p) => matches(path, p))) {
    return role === "SUPER_ADMIN";
  }
  return true;
}
