import { config } from "@/lib/env";
import { DENIED, type Actor, type Action, type Grant, type Permission, type Resource, type Role } from "./types";

type Row = Record<Role, Grant | (() => Grant)>;

const ALL: Grant = { allowed: true, scope: "all" };
const OWN: Grant = { allowed: true, scope: "own" };

/**
 * Section 7 of the technical plan, transcribed one row per table row.
 * This object is the single source of truth for authorization.
 */
const MATRIX: Partial<Record<Permission, Row>> = {
  // Manage users/invites — Yes / No / No
  "manage:user": { SUPER_ADMIN: ALL, SALES: DENIED, OUTSIDE_SALES: DENIED },
  "manage:invite": { SUPER_ADMIN: ALL, SALES: DENIED, OUTSIDE_SALES: DENIED },

  // View all clients/contracts — Yes / Yes / No (own only)
  "viewAll:client": { SUPER_ADMIN: ALL, SALES: ALL, OUTSIDE_SALES: OWN },
  "viewAll:contract": { SUPER_ADMIN: ALL, SALES: ALL, OUTSIDE_SALES: OWN },

  // Create client — Yes / Yes / Yes (own, may require approval)
  "create:client": {
    SUPER_ADMIN: ALL,
    SALES: ALL,
    OUTSIDE_SALES: () => ({
      allowed: true,
      scope: "own",
      requiresApproval: config.outsideSalesClientRequiresApproval,
    }),
  },

  // Create contract — Yes / Yes / No / limited (configurable)
  "create:contract": {
    SUPER_ADMIN: ALL,
    SALES: ALL,
    OUTSIDE_SALES: () =>
      config.outsideSalesCanCreateContract ? { allowed: true, scope: "own" } : DENIED,
  },

  // Edit commission % — Yes / No / No
  "editCommissionPercentage:contract": { SUPER_ADMIN: ALL, SALES: DENIED, OUTSIDE_SALES: DENIED },

  // Add bill — Yes / Yes (own contracts) / Yes (own contracts only)
  "create:bill": { SUPER_ADMIN: ALL, SALES: OWN, OUTSIDE_SALES: OWN },

  // Verify/dispute bill — Yes / Yes (own contracts) / No
  "verify:bill": { SUPER_ADMIN: ALL, SALES: OWN, OUTSIDE_SALES: DENIED },

  // Approve/pay commissions — Yes / No / No
  "approve:commission": { SUPER_ADMIN: ALL, SALES: DENIED, OUTSIDE_SALES: DENIED },
  "pay:commission": { SUPER_ADMIN: ALL, SALES: DENIED, OUTSIDE_SALES: DENIED },

  // Derived in Phase 3, not a row of the section 7 table: the table settles who
  // approves and pays, and who sees the leaderboard, but not who may read the
  // payout list. A commission row is personal compensation, so a rep sees their
  // own and nobody else's; aggregate standings stay with the leaderboard row.
  "viewAll:commission": { SUPER_ADMIN: ALL, SALES: OWN, OUTSIDE_SALES: OWN },

  // Derived in Phase 5, not a row of the section 7 table: a notification is
  // addressed to one person. Everybody — a Super Admin included — reads their own
  // bell and nobody else's, so the scope is "own" for all three roles and the
  // query filter, not a role check, is what enforces it.
  "view:notification": { SUPER_ADMIN: OWN, SALES: OWN, OUTSIDE_SALES: OWN },

  // View full leaderboard — Yes / Yes / No (own stats + own rank only)
  "viewFull:leaderboard": { SUPER_ADMIN: ALL, SALES: ALL, OUTSIDE_SALES: DENIED },

  // View audit logs — Yes / No / No
  "view:auditLog": { SUPER_ADMIN: ALL, SALES: DENIED, OUTSIDE_SALES: DENIED },

  // Terminate/renew contract — Yes / Yes (own, with limits) / No
  "terminate:contract": { SUPER_ADMIN: ALL, SALES: OWN, OUTSIDE_SALES: DENIED },
  "renew:contract": { SUPER_ADMIN: ALL, SALES: OWN, OUTSIDE_SALES: DENIED },
};

/** Full grant (allowed + scope) for an actor. Unknown permissions are denied. */
export function permissionFor(actor: Actor, action: Action, resource: Resource): Grant {
  const row = MATRIX[`${action}:${resource}` as Permission];
  if (!row) return DENIED;
  const cell = row[actor.role];
  if (!cell) return DENIED;
  return typeof cell === "function" ? cell() : cell;
}

/** The `can(user, action, resource)` function the plan requires in every handler. */
export function can(actor: Actor, action: Action, resource: Resource): boolean {
  return permissionFor(actor, action, resource).allowed;
}

/** True when the actor may only see their own rows for this permission. */
export function isOwnScoped(actor: Actor, action: Action, resource: Resource): boolean {
  return permissionFor(actor, action, resource).scope === "own";
}
