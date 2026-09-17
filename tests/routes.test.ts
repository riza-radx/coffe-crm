import { describe, expect, it } from "vitest";
import { canAccessPath, isPublicPath } from "@/lib/rbac/routes";
import { ROLES } from "@/lib/rbac/types";

describe("page gating — 3 roles x 3 paths", () => {
  const cases: Array<[string, Record<string, boolean>]> = [
    ["/dashboard", { SUPER_ADMIN: true, SALES: true, OUTSIDE_SALES: true }],
    ["/clients", { SUPER_ADMIN: true, SALES: true, OUTSIDE_SALES: true }],
    ["/users", { SUPER_ADMIN: true, SALES: false, OUTSIDE_SALES: false }],
  ];

  for (const [path, expected] of cases) {
    for (const role of ROLES) {
      it(`${role} → ${path} = ${expected[role]}`, () => {
        expect(canAccessPath(role, path)).toBe(expected[role]);
      });
    }
  }

  it("locks every Super-Admin-only subtree", () => {
    for (const path of ["/users/abc", "/settings", "/audit-logs?page=2"]) {
      expect(canAccessPath("SALES", path)).toBe(false);
      expect(canAccessPath("SUPER_ADMIN", path)).toBe(true);
    }
  });

  it("rejects anonymous visitors everywhere but the public paths", () => {
    expect(canAccessPath(null, "/dashboard")).toBe(false);
    expect(canAccessPath(null, "/login")).toBe(true);
    expect(canAccessPath(null, "/invite/abc123")).toBe(true);
  });

  it("knows which paths are public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/invite/xyz")).toBe(true);
    expect(isPublicPath("/invites")).toBe(false);
    expect(isPublicPath("/dashboard")).toBe(false);
  });
});
