import type { Tx } from "@/lib/db";
import type { AuditEntityType } from "@/lib/audit/log";
import { loadPreferences, resolvePreference } from "./preferences";
import { NOTIFICATION_TYPES, type NotificationType } from "./types";

export { NOTIFICATION_TYPES };
export type { NotificationType };

export type NotificationDraft = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: AuditEntityType;
  entityId?: string;
  /**
   * Section 8 emails a subset of the feed: contract expiring, bill disputed,
   * commission approved/paid, invite accepted. The flag travels with the draft so
   * the decision sits beside the message rather than in the worker.
   */
  email?: boolean;
};

/**
 * The only writer of `notifications`, and — like writeAudit — it takes the
 * transaction client rather than importing `prisma`. A notification therefore
 * cannot outlive the mutation that caused it: a rolled-back approval leaves no
 * "your commission was approved" in anybody's bell.
 *
 * Email is the opposite concern: it must *not* be sent inside the transaction,
 * because an SMTP timeout would roll back an approval that is otherwise fine. So
 * this returns the ids that want an email, and the caller enqueues them after the
 * commit (see lib/jobs/queue.ts).
 */
export async function writeNotifications(
  tx: Tx,
  drafts: readonly NotificationDraft[],
): Promise<string[]> {
  // Phase 6: the row is written whatever the preference — it is the record that
  // the event happened, and `in_app` only decides whether the bell shows it. What
  // the preference does decide is the email: now, in tonight's digest, or never.
  const preferences = await loadPreferences(tx, drafts);

  const emailable: string[] = [];
  for (const draft of drafts) {
    const row = (await tx.notification.create({
      data: {
        userId: draft.userId,
        type: draft.type,
        title: draft.title,
        body: draft.body,
        entityType: draft.entityType ?? null,
        entityId: draft.entityId ?? null,
      },
      select: { id: true },
    })) as { id: string };

    const delivery = resolvePreference(preferences, draft.userId, draft.type).email;
    if (draft.email && delivery === "INSTANT") emailable.push(row.id);
  }
  return emailable;
}

/** One place for the wording, so the bell and the email never drift apart. */
export const templates = {
  contractExpiring(params: { userId: string; contractId: string; clientName: string; endDate: string; days: number }): NotificationDraft {
    return {
      userId: params.userId,
      type: "CONTRACT_EXPIRING",
      title: `Kontrata e ${params.clientName} skadon më ${params.endDate}`,
      body: `Kontrata skadon për ${params.days} ditë. Rinovoje ose ndërprite para datës së skadimit.`,
      entityType: "CONTRACT",
      entityId: params.contractId,
      email: true,
    };
  },

  contractExpired(params: { userId: string; contractId: string; clientName: string; endDate: string }): NotificationDraft {
    return {
      userId: params.userId,
      type: "CONTRACT_EXPIRED",
      title: `Kontrata e ${params.clientName} skadoi`,
      body: `Data e mbarimit ishte ${params.endDate}. Kontrata kaloi automatikisht në EXPIRED dhe nuk pranon më fatura.`,
      entityType: "CONTRACT",
      entityId: params.contractId,
      email: true,
    };
  },

  billDisputed(params: { userId: string; billId: string; billNumber: string; reason?: string | null }): NotificationDraft {
    return {
      userId: params.userId,
      type: "BILL_DISPUTED",
      title: `Fatura ${params.billNumber} u kontestua`,
      body: params.reason
        ? `Arsyeja: ${params.reason}`
        : "Fatura kaloi në DISPUTED; komisioni përkatës u tërhoq derisa të zgjidhet.",
      entityType: "BILL",
      entityId: params.billId,
      email: true,
    };
  },

  commissionApproved(params: { userId: string; commissionId: string; amount: string }): NotificationDraft {
    return {
      userId: params.userId,
      type: "COMMISSION_APPROVED",
      title: "Komisioni u aprovua",
      body: `Komisioni prej ${params.amount} u aprovua dhe pret pagesën.`,
      entityType: "COMMISSION",
      entityId: params.commissionId,
      email: true,
    };
  },

  commissionPaid(params: { userId: string; commissionId: string; amount: string }): NotificationDraft {
    return {
      userId: params.userId,
      type: "COMMISSION_PAID",
      title: "Komisioni u pagua",
      body: `Komisioni prej ${params.amount} u shënua si i paguar.`,
      entityType: "COMMISSION",
      entityId: params.commissionId,
      email: true,
    };
  },

  inviteAccepted(params: { userId: string; newUserId: string; name: string; email: string }): NotificationDraft {
    return {
      userId: params.userId,
      type: "INVITE_ACCEPTED",
      title: `${params.name} pranoi ftesën`,
      body: `${params.email} tani ka një llogari aktive.`,
      entityType: "USER",
      entityId: params.newUserId,
      email: true,
    };
  },
};
