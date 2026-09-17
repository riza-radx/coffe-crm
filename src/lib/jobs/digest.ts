import { prisma } from "@/lib/db";
import { bodyWithLink, sendMail } from "@/lib/email/mailer";
import { startOfUtcDay, addDays } from "./contract-sweep";

/**
 * The digest half of "digest vs. instant delivery" (section 8).
 *
 * A user whose preference for a type is DIGEST gets no email when the event
 * happens; instead one email a day lists everything that arrived. The window is a
 * whole UTC day rather than "since the last run", because a date is reproducible:
 * a missed night can be re-run for that exact date and produces exactly the same
 * email. The cost of that choice is that a re-run sends it twice, which is the
 * right way round — a duplicate is visible, a silent gap is not.
 */
export type DigestResult = { day: string; users: number; notifications: number };

type DigestRow = {
  userId: string;
  type: string;
  title: string;
  body: string;
  createdAt: Date;
  user: { email: string; name: string; status: string };
};

/** Defaults to yesterday: the last day that is certainly complete. */
export function digestDay(now: Date = new Date()): Date {
  return addDays(startOfUtcDay(now), -1);
}

export async function sendDailyDigest(day: Date = digestDay()): Promise<DigestResult> {
  const gte = startOfUtcDay(day);
  const lt = addDays(gte, 1);
  const key = gte.toISOString().slice(0, 10);

  const subscriptions = (await prisma.notificationPreference.findMany({
    where: { email: "DIGEST" },
    select: { userId: true, type: true },
  })) as Array<{ userId: string; type: string }>;

  if (subscriptions.length === 0) return { day: key, users: 0, notifications: 0 };

  // One OR branch per (user, type) that asked for a digest. The set is bounded by
  // users × notification types, and only the rows people actually opted into.
  const rows = (await prisma.notification.findMany({
    where: {
      createdAt: { gte, lt },
      OR: subscriptions.map((sub) => ({ userId: sub.userId, type: sub.type })),
    },
    select: {
      userId: true,
      type: true,
      title: true,
      body: true,
      createdAt: true,
      user: { select: { email: true, name: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  })) as DigestRow[];

  const byUser = new Map<string, DigestRow[]>();
  for (const row of rows) {
    if (row.user.status !== "ACTIVE") continue;
    const list = byUser.get(row.userId);
    if (list) list.push(row);
    else byUser.set(row.userId, [row]);
  }

  for (const [, items] of byUser) {
    await sendMail({
      to: items[0].user.email,
      subject: `Rei CRM — përmbledhja e ${key} (${items.length})`,
      text: bodyWithLink(digestBody(items[0].user.name, items), "/dashboard"),
    });
  }

  return { day: key, users: byUser.size, notifications: rows.length };
}

export function digestBody(name: string, items: readonly { title: string; body: string }[]): string {
  const lines = items.map((item) => `• ${item.title}\n  ${item.body}`);
  return `Përshëndetje ${name},\n\nKëto ndodhën dje:\n\n${lines.join("\n\n")}`;
}
