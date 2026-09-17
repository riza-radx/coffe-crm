import { beforeEach, describe, expect, it } from "vitest";
import { can, permissionFor } from "@/lib/rbac/matrix";
import { ownerFilter } from "@/lib/rbac/scope";
import { ROLES, type Action, type Actor, type Resource, type Role } from "@/lib/rbac/types";

const actor = (role: Role): Actor => ({ id: `u-${role}`, role });

/**
 * Section 7 of the technical plan, transcribed independently of the
 * implementation. If the table changes, this array changes with it.
 */
type Expected = "all" | "own" | "none";
const TABLE: Array<{
  row: string;
  action: Action;
  resource: Resource;
  SUPER_ADMIN: Expected;
  SALES: Expected;
  OUTSIDE_SALES: Expected;
}> = [
  { row: "Manage users/invites", action: "manage", resource: "user", SUPER_ADMIN: "all", SALES: "none", OUTSIDE_SALES: "none" },
  { row: "Manage users/invites", action: "manage", resource: "invite", SUPER_ADMIN: "all", SALES: "none", OUTSIDE_SALES: "none" },
  { row: "View all clients", action: "viewAll", resource: "client", SUPER_ADMIN: "all", SALES: "all", OUTSIDE_SALES: "own" },
  { row: "View all contracts", action: "viewAll", resource: "contract", SUPER_ADMIN: "all", SALES: "all", OUTSIDE_SALES: "own" },
  { row: "Create client", action: "create", resource: "client", SUPER_ADMIN: "all", SALES: "all", OUTSIDE_SALES: "own" },
  { row: "Create contract", action: "create", resource: "contract", SUPER_ADMIN: "all", SALES: "all", OUTSIDE_SALES: "none" },
  { row: "Edit commission %", action: "editCommissionPercentage", resource: "contract", SUPER_ADMIN: "all", SALES: "none", OUTSIDE_SALES: "none" },
  { row: "Add bill", action: "create", resource: "bill", SUPER_ADMIN: "all", SALES: "own", OUTSIDE_SALES: "own" },
  { row: "Verify/dispute bill", action: "verify", resource: "bill", SUPER_ADMIN: "all", SALES: "own", OUTSIDE_SALES: "none" },
  { row: "Approve commissions", action: "approve", resource: "commission", SUPER_ADMIN: "all", SALES: "none", OUTSIDE_SALES: "none" },
  { row: "Pay commissions", action: "pay", resource: "commission", SUPER_ADMIN: "all", SALES: "none", OUTSIDE_SALES: "none" },
  { row: "View full leaderboard", action: "viewFull", resource: "leaderboard", SUPER_ADMIN: "all", SALES: "all", OUTSIDE_SALES: "none" },
  { row: "View audit logs", action: "view", resource: "auditLog", SUPER_ADMIN: "all", SALES: "none", OUTSIDE_SALES: "none" },
  { row: "Terminate contract", action: "terminate", resource: "contract", SUPER_ADMIN: "all", SALES: "own", OUTSIDE_SALES: "none" },
  { row: "Renew contract", action: "renew", resource: "contract", SUPER_ADMIN: "all", SALES: "own", OUTSIDE_SALES: "none" },
];

describe("RBAC matrix — section 7 of the plan", () => {
  beforeEach(() => {
    delete process.env.OUTSIDE_SALES_CAN_CREATE_CONTRACT;
    delete process.env.OUTSIDE_SALES_CLIENT_REQUIRES_APPROVAL;
  });

  for (const entry of TABLE) {
    for (const role of ROLES) {
      const expected = entry[role];
      it(`${entry.row} · ${role} → ${expected}`, () => {
        const grant = permissionFor(actor(role), entry.action, entry.resource);
        expect(grant.scope).toBe(expected);
        expect(grant.allowed).toBe(expected !== "none");
      });
    }
  }

  it("denies unknown permissions by default", () => {
    expect(can(actor("SUPER_ADMIN"), "approve" as Action, "client" as Resource)).toBe(false);
  });
});

describe("configurable cells", () => {
  beforeEach(() => {
    delete process.env.OUTSIDE_SALES_CAN_CREATE_CONTRACT;
    delete process.env.OUTSIDE_SALES_CLIENT_REQUIRES_APPROVAL;
  });

  it("Outside Sales cannot create contracts by default", () => {
    expect(can(actor("OUTSIDE_SALES"), "create", "contract")).toBe(false);
  });

  it("Outside Sales can create contracts when the flag is on, scoped to own", () => {
    process.env.OUTSIDE_SALES_CAN_CREATE_CONTRACT = "true";
    expect(permissionFor(actor("OUTSIDE_SALES"), "create", "contract")).toEqual({
      allowed: true,
      scope: "own",
    });
  });

  it("Outside Sales client creation carries the approval flag when configured", () => {
    process.env.OUTSIDE_SALES_CLIENT_REQUIRES_APPROVAL = "true";
    expect(permissionFor(actor("OUTSIDE_SALES"), "create", "client").requiresApproval).toBe(true);
  });
});

describe("query-level scoping", () => {
  it("Super Admin gets no filter", () => {
    expect(ownerFilter(actor("SUPER_ADMIN"), "viewAll", "contract")).toEqual({});
  });

  it("Outside Sales is pinned to their own rows", () => {
    expect(ownerFilter(actor("OUTSIDE_SALES"), "viewAll", "contract")).toEqual({
      salesOwnerId: "u-OUTSIDE_SALES",
    });
  });

  it("uses the field name the caller passes", () => {
    expect(ownerFilter(actor("OUTSIDE_SALES"), "viewAll", "client", "acquiredById")).toEqual({
      acquiredById: "u-OUTSIDE_SALES",
    });
  });

  it("a denied permission still yields a filter that can match nothing", () => {
    const filter = ownerFilter(actor("SALES"), "view", "auditLog");
    expect(Object.values(filter)).toEqual(["__denied__"]);
  });
});
