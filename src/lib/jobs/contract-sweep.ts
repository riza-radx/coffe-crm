import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit/log";
import { templates, writeNotifications } from "@/lib/notifications/notify";
import { checkTransition, type ContractStatus } from "@/lib/contracts/state-machine";
import { toDateOnly } from "@/lib/validation/common";
import { config } from "@/lib/env";

export type SweepResult = {
  expired: string[];
  warned: string[];
  emails: string[];
};

/** Midnight UTC of the day `now` falls in — the boundary all date-only fields use. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * The daily sweep of section 6: "EXPIRED — auto-transitioned by a daily job when
 * end_date passes with no renewal", plus section 8's "contract expiring in N days".
 *
 * Two details worth stating:
 *
 *  - The actor is null. A contract that expires was not expired *by* anyone, and
 *    audit_logs was built with a nullable actor_id for exactly this.
 *  - A contract that has already been renewed is left alone even if its end_date
 *    has passed: renewal moved it to RENEWED, and the state machine has no path
 *    out of a terminal state. The query therefore selects ACTIVE only, which is
 *    the same guard stated twice — once in SQL and once in checkTransition.
 */
export async function sweepContracts(now: Date = new Date()): Promise<SweepResult> {
  const today = startOfUtcDay(now);
  const horizon = addDays(today, config.contractExpiryWarningDays);

  const expired: string[] = [];
  const warned: string[] = [];
  const emails: string[] = [];

  const due = (await prisma.contract.findMany({
    where: { status: "ACTIVE", endDate: { not: null, lt: today } },
    select: {
      id: true,
      status: true,
      endDate: true,
      salesOwnerId: true,
      client: { select: { name: true } },
    },
  })) as ExpiringRow[];

  for (const contract of due) {
    const verdict = checkTransition(contract.status as ContractStatus, "EXPIRED", "job");
    if (!verdict.ok) continue;

    const sent = await prisma.$transaction(async (tx) => {
      const moved = await tx.contract.updateMany({
        where: { id: contract.id, status: "ACTIVE" },
        data: { status: "EXPIRED" },
      });
      // Somebody renewed or terminated it between the read and the write; their
      // move wins and the sweep leaves it alone.
      if (moved.count !== 1) return null;

      await writeAudit(tx, {
        actorId: null,
        entityType: "CONTRACT",
        entityId: contract.id,
        action: "STATUS_CHANGE",
        diff: {
          before: { status: "ACTIVE" },
          after: { status: "EXPIRED" },
          reason: "END_DATE_PASSED",
          endDate: toDateOnly(contract.endDate!),
        },
      });

      return writeNotifications(tx, [
        templates.contractExpired({
          userId: contract.salesOwnerId,
          contractId: contract.id,
          clientName: contract.client.name,
          endDate: toDateOnly(contract.endDate!),
        }),
      ]);
    });

    if (sent) {
      expired.push(contract.id);
      emails.push(...sent);
    }
  }

  const upcoming = (await prisma.contract.findMany({
    where: { status: "ACTIVE", endDate: { gte: today, lte: horizon } },
    select: {
      id: true,
      status: true,
      endDate: true,
      salesOwnerId: true,
      client: { select: { name: true } },
    },
  })) as ExpiringRow[];

  for (const contract of upcoming) {
    const endDate = contract.endDate!;
    const windowOpened = addDays(startOfUtcDay(endDate), -config.contractExpiryWarningDays);

    // The sweep runs every day over the same window, so "have I already warned
    // about this one" has to be answered from the data rather than from a cursor.
    // One notification per contract per warning window is the rule.
    const already = await prisma.notification.count({
      where: {
        type: "CONTRACT_EXPIRING",
        entityType: "CONTRACT",
        entityId: contract.id,
        createdAt: { gte: windowOpened },
      },
    });
    if (already > 0) continue;

    const days = Math.round((startOfUtcDay(endDate).getTime() - today.getTime()) / 86_400_000);
    const sent = await prisma.$transaction((tx) =>
      writeNotifications(tx, [
        templates.contractExpiring({
          userId: contract.salesOwnerId,
          contractId: contract.id,
          clientName: contract.client.name,
          endDate: toDateOnly(endDate),
          days,
        }),
      ]),
    );
    warned.push(contract.id);
    emails.push(...sent);
  }

  return { expired, warned, emails };
}

type ExpiringRow = {
  id: string;
  status: string;
  endDate: Date | null;
  salesOwnerId: string;
  client: { name: string };
};
