import { randomBytes } from "node:crypto";
import { config } from "@/lib/env";

export type InviteRecord = {
  expiresAt: Date;
  acceptedAt: Date | null;
} | null;

export type InviteState = "VALID" | "NOT_FOUND" | "EXPIRED" | "ALREADY_USED";

/** 256 bits of entropy, URL-safe. */
export function createInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + config.inviteTtlHours * 60 * 60 * 1000);
}

/**
 * Pure state check for an invite token — the whole accept-invite decision in one
 * testable function. Order matters: a used invite reads as used even after expiry.
 */
export function inviteState(invite: InviteRecord, now: Date = new Date()): InviteState {
  if (!invite) return "NOT_FOUND";
  if (invite.acceptedAt !== null) return "ALREADY_USED";
  if (invite.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "VALID";
}
