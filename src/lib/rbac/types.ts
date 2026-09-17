export type Role = "SUPER_ADMIN" | "SALES" | "OUTSIDE_SALES";
export type UserStatus = "ACTIVE" | "INVITED" | "SUSPENDED";

export const ROLES: readonly Role[] = ["SUPER_ADMIN", "SALES", "OUTSIDE_SALES"];

/** The minimum an RBAC decision needs. Never the full Prisma row. */
export type Actor = {
  id: string;
  role: Role;
};

export type Action =
  | "manage"
  | "viewAll"
  | "create"
  | "editCommissionPercentage"
  | "verify"
  | "approve"
  | "pay"
  | "viewFull"
  | "view"
  | "terminate"
  | "renew";

export type Resource =
  | "user"
  | "invite"
  | "client"
  | "contract"
  | "bill"
  | "commission"
  | "leaderboard"
  | "auditLog"
  | "notification";

export type Permission = `${Action}:${Resource}`;

/**
 * "all"  — every row
 * "own"  — only rows the actor owns (enforced by ownerFilter at the query level)
 * "none" — denied
 */
export type Scope = "all" | "own" | "none";

export type Grant = {
  allowed: boolean;
  scope: Scope;
  /** Plan: Outside Sales may create clients "(own, may require approval)". */
  requiresApproval?: boolean;
};

export const DENIED: Grant = { allowed: false, scope: "none" };
