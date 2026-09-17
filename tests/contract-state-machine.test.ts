import { describe, expect, it } from "vitest";
import {
  CONTRACT_TRANSITIONS,
  acceptsBills,
  canTransition,
  checkTransition,
  isTerminal,
  type ContractStatus,
} from "@/lib/contracts/state-machine";

const ALL: ContractStatus[] = ["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED", "RENEWED"];

/** The state diagram in section 6, written out independently of the implementation. */
const ALLOWED = new Set([
  "DRAFT->ACTIVE",
  "ACTIVE->EXPIRED",
  "ACTIVE->TERMINATED",
  "ACTIVE->RENEWED",
]);

describe("contract state machine", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const expected = ALLOWED.has(`${from}->${to}`);
      it(`${from} → ${to} is ${expected ? "allowed" : "forbidden"}`, () => {
        expect(canTransition(from, to)).toBe(expected);
      });
    }
  }

  it("has no self-transitions", () => {
    for (const status of ALL) {
      expect(CONTRACT_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it("treats EXPIRED, TERMINATED and RENEWED as terminal", () => {
    expect(isTerminal("EXPIRED")).toBe(true);
    expect(isTerminal("TERMINATED")).toBe(true);
    expect(isTerminal("RENEWED")).toBe(true);
    expect(isTerminal("DRAFT")).toBe(false);
    expect(isTerminal("ACTIVE")).toBe(false);
  });

  it("accepts bills only while ACTIVE", () => {
    for (const status of ALL) {
      expect(acceptsBills(status)).toBe(status === "ACTIVE");
    }
  });
});

describe("which door a transition arrives through", () => {
  it("allows DRAFT → ACTIVE on a plain PATCH", () => {
    expect(checkTransition("DRAFT", "ACTIVE")).toEqual({ ok: true });
  });

  it("rejects a no-op transition distinctly", () => {
    expect(checkTransition("ACTIVE", "ACTIVE")).toEqual({ ok: false, code: "SAME_STATUS" });
  });

  it("rejects a move the diagram forbids", () => {
    expect(checkTransition("EXPIRED", "ACTIVE")).toEqual({ ok: false, code: "INVALID_TRANSITION" });
    expect(checkTransition("DRAFT", "TERMINATED")).toEqual({
      ok: false,
      code: "INVALID_TRANSITION",
    });
  });

  it("separates 'wrong door' from 'illegal'", () => {
    for (const to of ["EXPIRED", "TERMINATED", "RENEWED"] as const) {
      expect(checkTransition("ACTIVE", to)).toEqual({ ok: false, code: "WRONG_CHANNEL" });
    }
  });

  it("opens each Phase 5 move on its own channel only", () => {
    expect(checkTransition("ACTIVE", "RENEWED", "renew")).toEqual({ ok: true });
    expect(checkTransition("ACTIVE", "TERMINATED", "terminate")).toEqual({ ok: true });
    expect(checkTransition("ACTIVE", "EXPIRED", "job")).toEqual({ ok: true });
  });

  it("refuses a move made through somebody else's channel", () => {
    expect(checkTransition("ACTIVE", "TERMINATED", "renew")).toEqual({
      ok: false,
      code: "WRONG_CHANNEL",
    });
    expect(checkTransition("ACTIVE", "RENEWED", "terminate")).toEqual({
      ok: false,
      code: "WRONG_CHANNEL",
    });
    // Expiry is the job's alone: nobody may type a contract into EXPIRED.
    for (const channel of ["patch", "renew", "terminate"] as const) {
      expect(checkTransition("ACTIVE", "EXPIRED", channel)).toEqual({
        ok: false,
        code: "WRONG_CHANNEL",
      });
    }
    expect(checkTransition("DRAFT", "ACTIVE", "job")).toEqual({ ok: false, code: "WRONG_CHANNEL" });
  });
});
