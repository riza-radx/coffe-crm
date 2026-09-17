export type ContractStatus = "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED" | "RENEWED";

/**
 * The state diagram in section 6 of the technical plan, transcribed exactly:
 *   [*] -> DRAFT -> ACTIVE -> { EXPIRED | TERMINATED | RENEWED } -> [*]
 * Terminal states have no outgoing transitions.
 */
export const CONTRACT_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  DRAFT: ["ACTIVE"],
  ACTIVE: ["EXPIRED", "TERMINATED", "RENEWED"],
  EXPIRED: [],
  TERMINATED: [],
  RENEWED: [],
};

/**
 * A legal transition is not legal through every door.
 *
 * Section 4 gives termination and renewal their own endpoints, because each
 * carries data a PATCH has nowhere to put — a reason, a successor contract — and
 * section 6 makes expiry something "auto-transitioned by a daily job", never a
 * status a person may type. So the state machine answers two questions, not one:
 * is the move on the diagram, and did it arrive through its own door.
 */
export type TransitionChannel = "patch" | "renew" | "terminate" | "job";

const CHANNEL_TRANSITIONS: Record<TransitionChannel, readonly `${ContractStatus}->${ContractStatus}`[]> = {
  patch: ["DRAFT->ACTIVE"],
  renew: ["ACTIVE->RENEWED"],
  terminate: ["ACTIVE->TERMINATED"],
  // The expiry job also activates nothing and terminates nothing: one move only.
  job: ["ACTIVE->EXPIRED"],
};

/** Kept for readers of Phase 2: the only move a plain PATCH may make. */
export const PATCH_TRANSITIONS = CHANNEL_TRANSITIONS.patch;

export type TransitionVerdict =
  | { ok: true }
  | { ok: false; code: "SAME_STATUS" | "INVALID_TRANSITION" | "WRONG_CHANNEL" };

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[status].length === 0;
}

/** Bills may only be attached while the contract is ACTIVE (section 6). */
export function acceptsBills(status: ContractStatus): boolean {
  return status === "ACTIVE";
}

/**
 * `channel` defaults to "patch" so a caller that forgets it gets the narrowest
 * door rather than the widest.
 */
export function checkTransition(
  from: ContractStatus,
  to: ContractStatus,
  channel: TransitionChannel = "patch",
): TransitionVerdict {
  if (from === to) return { ok: false, code: "SAME_STATUS" };
  if (!canTransition(from, to)) return { ok: false, code: "INVALID_TRANSITION" };
  if (!CHANNEL_TRANSITIONS[channel].includes(`${from}->${to}`)) {
    return { ok: false, code: "WRONG_CHANNEL" };
  }
  return { ok: true };
}
