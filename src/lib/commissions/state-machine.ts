export type CommissionStatus = "PENDING" | "APPROVED" | "PAID";

/**
 * Section 2 lists the three statuses; Phase 3 item 10 ("commission approval +
 * payment marking") is the order they run in:
 *
 *   PENDING -> APPROVED -> PAID
 *
 * PAID is terminal. There is no APPROVED -> PENDING edge: un-approving a payout
 * would need a reversal entry the plan does not define, and the auditable way
 * back is to dispute the underlying bill while the commission is still PENDING.
 */
export const COMMISSION_TRANSITIONS: Record<CommissionStatus, readonly CommissionStatus[]> = {
  PENDING: ["APPROVED"],
  APPROVED: ["PAID"],
  PAID: [],
};

export type CommissionTransitionVerdict =
  | { ok: true }
  | { ok: false; code: "SAME_STATUS" | "INVALID_TRANSITION" };

export function canTransitionCommission(from: CommissionStatus, to: CommissionStatus): boolean {
  return COMMISSION_TRANSITIONS[from].includes(to);
}

export function checkCommissionTransition(
  from: CommissionStatus,
  to: CommissionStatus,
): CommissionTransitionVerdict {
  if (from === to) return { ok: false, code: "SAME_STATUS" };
  if (!canTransitionCommission(from, to)) return { ok: false, code: "INVALID_TRANSITION" };
  return { ok: true };
}

/**
 * A commission may only be reversed while it is still PENDING. Once it is
 * approved — let alone paid — the month is closed as far as this row is
 * concerned, and the bill behind it can no longer be disputed or voided.
 */
export function isCommissionDeletable(status: CommissionStatus): boolean {
  return status === "PENDING";
}
