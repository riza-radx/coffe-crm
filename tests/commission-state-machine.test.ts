import { describe, expect, it } from "vitest";
import {
  COMMISSION_TRANSITIONS,
  canTransitionCommission,
  checkCommissionTransition,
  isCommissionDeletable,
  type CommissionStatus,
} from "@/lib/commissions/state-machine";

const STATUSES: CommissionStatus[] = ["PENDING", "APPROVED", "PAID"];

const ALLOWED: Record<CommissionStatus, CommissionStatus[]> = {
  PENDING: ["APPROVED"],
  APPROVED: ["PAID"],
  PAID: [],
};

describe("commission transitions", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const allowed = ALLOWED[from].includes(to);
      it(`${from} → ${to} is ${allowed ? "allowed" : from === to ? "the same status" : "forbidden"}`, () => {
        expect(canTransitionCommission(from, to)).toBe(allowed);
        const verdict = checkCommissionTransition(from, to);
        if (allowed) expect(verdict).toEqual({ ok: true });
        else if (from === to) expect(verdict).toEqual({ ok: false, code: "SAME_STATUS" });
        else expect(verdict).toEqual({ ok: false, code: "INVALID_TRANSITION" });
      });
    }
  }

  it("cannot skip approval on the way to PAID", () => {
    expect(checkCommissionTransition("PENDING", "PAID")).toEqual({
      ok: false,
      code: "INVALID_TRANSITION",
    });
  });

  it("cannot walk back an approval", () => {
    expect(checkCommissionTransition("APPROVED", "PENDING")).toEqual({
      ok: false,
      code: "INVALID_TRANSITION",
    });
  });

  it("leaves PAID terminal", () => {
    expect(COMMISSION_TRANSITIONS.PAID).toHaveLength(0);
  });
});

describe("a closed payout cannot be reversed", () => {
  it("only a pending commission may be deleted with its bill", () => {
    expect(isCommissionDeletable("PENDING")).toBe(true);
    expect(isCommissionDeletable("APPROVED")).toBe(false);
    expect(isCommissionDeletable("PAID")).toBe(false);
  });
});
