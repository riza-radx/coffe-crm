/**
 * Section 2 lists `type (CONTRACT_EXPIRING, BILL_DISPUTED, COMMISSION_APPROVED,
 * etc.)`; these are the "etc." resolved to exactly the events section 8 names as
 * needing a notification, and nothing beyond them.
 *
 * They live in their own module because both the writer (notify.ts) and the
 * preferences (preferences.ts) need them, and each needs the other.
 */
export const NOTIFICATION_TYPES = [
  "CONTRACT_EXPIRING",
  "CONTRACT_EXPIRED",
  "BILL_DISPUTED",
  "COMMISSION_APPROVED",
  "COMMISSION_PAID",
  "INVITE_ACCEPTED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
