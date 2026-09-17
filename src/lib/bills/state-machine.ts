export type BillStatus = "PENDING" | "VERIFIED" | "DISPUTED" | "VOID";

/**
 * The bill statuses in section 2 of the technical plan, with the verification
 * workflow of section 6 (Phase 3, item 9) drawn between them:
 *
 *   PENDING  -> VERIFIED | DISPUTED | VOID
 *   VERIFIED -> DISPUTED | VOID          (the commission is reversed with it)
 *   DISPUTED -> VERIFIED | VOID          (a resolved dispute is verifiable again)
 *   VOID     -> —                        (terminal: a voided bill is history)
 *
 * Re-verifying a disputed bill creates a *fresh* commission at the contract's
 * percentage as of that moment, because the first one was deleted on dispute.
 * That is the one legitimate way an amended percentage changes a payout, which
 * is why both steps are audit-logged with their before-values.
 */
export const BILL_TRANSITIONS: Record<BillStatus, readonly BillStatus[]> = {
  PENDING: ["VERIFIED", "DISPUTED", "VOID"],
  VERIFIED: ["DISPUTED", "VOID"],
  DISPUTED: ["VERIFIED", "VOID"],
  VOID: [],
};

export type BillTransitionVerdict =
  | { ok: true }
  | { ok: false; code: "SAME_STATUS" | "INVALID_TRANSITION" };

export function canTransitionBill(from: BillStatus, to: BillStatus): boolean {
  return BILL_TRANSITIONS[from].includes(to);
}

export function checkBillTransition(from: BillStatus, to: BillStatus): BillTransitionVerdict {
  if (from === to) return { ok: false, code: "SAME_STATUS" };
  if (!canTransitionBill(from, to)) return { ok: false, code: "INVALID_TRANSITION" };
  return { ok: true };
}

/** Fields of a bill may only be corrected before it is verified. */
export function isBillEditable(status: BillStatus): boolean {
  return status === "PENDING";
}

/** Moving here snapshots a commission (section 6: "the moment a bill moves to VERIFIED"). */
export function createsCommission(to: BillStatus): boolean {
  return to === "VERIFIED";
}

/** Moving here reverses an existing commission. */
export function reversesCommission(to: BillStatus): boolean {
  return to === "DISPUTED" || to === "VOID";
}
