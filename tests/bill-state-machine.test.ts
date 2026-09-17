import { describe, expect, it } from "vitest";
import {
  BILL_TRANSITIONS,
  canTransitionBill,
  checkBillTransition,
  createsCommission,
  isBillEditable,
  reversesCommission,
  type BillStatus,
} from "@/lib/bills/state-machine";

const STATUSES: BillStatus[] = ["PENDING", "VERIFIED", "DISPUTED", "VOID"];

/** The machine, written out a second time, so widening the map fails a test. */
const ALLOWED: Record<BillStatus, BillStatus[]> = {
  PENDING: ["VERIFIED", "DISPUTED", "VOID"],
  VERIFIED: ["DISPUTED", "VOID"],
  DISPUTED: ["VERIFIED", "VOID"],
  VOID: [],
};

describe("bill transitions", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const allowed = ALLOWED[from].includes(to);
      it(`${from} → ${to} is ${allowed ? "allowed" : from === to ? "the same status" : "forbidden"}`, () => {
        expect(canTransitionBill(from, to)).toBe(allowed);
        const verdict = checkBillTransition(from, to);
        if (allowed) {
          expect(verdict).toEqual({ ok: true });
        } else if (from === to) {
          expect(verdict).toEqual({ ok: false, code: "SAME_STATUS" });
        } else {
          expect(verdict).toEqual({ ok: false, code: "INVALID_TRANSITION" });
        }
      });
    }
  }

  it("leaves VOID as the only terminal status", () => {
    expect(BILL_TRANSITIONS.VOID).toHaveLength(0);
    for (const status of ["PENDING", "VERIFIED", "DISPUTED"] as BillStatus[]) {
      expect(BILL_TRANSITIONS[status].length).toBeGreaterThan(0);
    }
  });

  it("allows a resolved dispute to be verified again", () => {
    expect(checkBillTransition("DISPUTED", "VERIFIED")).toEqual({ ok: true });
  });

  it("never returns to PENDING", () => {
    for (const from of STATUSES) {
      if (from !== "PENDING") expect(canTransitionBill(from, "PENDING")).toBe(false);
    }
  });
});

describe("what a transition does to the money", () => {
  it("only VERIFIED creates a commission", () => {
    expect(createsCommission("VERIFIED")).toBe(true);
    for (const status of ["PENDING", "DISPUTED", "VOID"] as BillStatus[]) {
      expect(createsCommission(status)).toBe(false);
    }
  });

  it("DISPUTED and VOID reverse one", () => {
    expect(reversesCommission("DISPUTED")).toBe(true);
    expect(reversesCommission("VOID")).toBe(true);
    expect(reversesCommission("VERIFIED")).toBe(false);
  });

  it("only a pending bill may be edited", () => {
    expect(isBillEditable("PENDING")).toBe(true);
    for (const status of ["VERIFIED", "DISPUTED", "VOID"] as BillStatus[]) {
      expect(isBillEditable(status)).toBe(false);
    }
  });
});
