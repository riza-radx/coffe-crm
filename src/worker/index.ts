import { prisma } from "@/lib/db";
import { config } from "@/lib/env";
import { bodyWithLink, sendMail } from "@/lib/email/mailer";
import { createBoss, QUEUES, type NotificationEmailJob } from "@/lib/jobs/queue";
import { sweepContracts } from "@/lib/jobs/contract-sweep";
import { rollupRecentMonths } from "@/lib/jobs/rollup";
import { sendDailyDigest } from "@/lib/jobs/digest";
import { sendMonthlyReport } from "@/lib/jobs/monthly-report";
import { shiftCron } from "@/lib/jobs/cron";

/**
 * The background worker: a second process from the same image, not a thread of
 * the web app. Next.js instances scale and restart with traffic, and a scheduled
 * job that runs once per instance is a job that runs three times; pg-boss's own
 * scheduler plus one dedicated process keeps "nightly" meaning nightly.
 *
 * Everything it does is idempotent, because at-least-once is what a queue
 * promises: the sweep re-reads status before moving a contract, the rollup
 * upserts, and an email job carries a notification id rather than a rendered
 * message.
 */

/** Where a notification points in the UI, used for the link inside its email. */
const LINKS: Record<string, (entityId: string | null) => string> = {
  CONTRACT_EXPIRING: (id) => (id ? `/contracts/${id}` : "/contracts"),
  CONTRACT_EXPIRED: (id) => (id ? `/contracts/${id}` : "/contracts"),
  BILL_DISPUTED: (id) => (id ? `/bills/${id}` : "/bills"),
  COMMISSION_APPROVED: () => "/commissions",
  COMMISSION_PAID: () => "/commissions",
  INVITE_ACCEPTED: () => "/users",
};

async function handleNotificationEmail(job: NotificationEmailJob): Promise<void> {
  const notification = await prisma.notification.findUnique({
    where: { id: job.notificationId },
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      entityId: true,
      user: { select: { email: true, status: true } },
    },
  });
  // The notification can be gone, or its user suspended, between enqueue and work.
  if (!notification || notification.user.status !== "ACTIVE") return;

  const link = LINKS[notification.type]?.(notification.entityId) ?? "/dashboard";
  await sendMail({
    to: notification.user.email,
    subject: notification.title,
    text: bodyWithLink(notification.body, link),
  });
}

async function main(): Promise<void> {
  const boss = createBoss();

  boss.on("error", (error) => console.error("[worker] pg-boss:", error));

  await boss.start();
  for (const name of Object.values(QUEUES)) await boss.createQueue(name);

  await boss.work<NotificationEmailJob>(QUEUES.notificationEmail, async (jobs) => {
    for (const job of jobs) await handleNotificationEmail(job.data);
  });

  await boss.work(QUEUES.contractSweep, async () => {
    const result = await sweepContracts();
    console.info(
      `[worker] sweep: ${result.expired.length} expired, ${result.warned.length} warned`,
    );
    // The sweep writes its notifications inside transactions and hands the email
    // ids back here, so a failed send never rolls back an expiry.
    for (const notificationId of result.emails) {
      await boss.send(QUEUES.notificationEmail, { notificationId });
    }
  });

  await boss.work(QUEUES.summaryRollup, async () => {
    const results = await rollupRecentMonths();
    for (const result of results) {
      console.info(
        `[worker] rollup ${result.month}: ${result.clients} clients, ${result.reps} reps`,
      );
    }
  });

  await boss.work(QUEUES.notificationDigest, async () => {
    const result = await sendDailyDigest();
    console.info(
      `[worker] digest ${result.day}: ${result.notifications} notifications to ${result.users} users`,
    );
  });

  await boss.work(QUEUES.monthlyReport, async () => {
    const result = await sendMonthlyReport();
    console.info(
      `[worker] monthly report ${result.month}: ${result.clients} clients, ${result.reps} reps → ${result.recipients} admins`,
    );
  });

  // Both run nightly; the sweep goes first so an expiry lands in the same night's
  // summary rather than the next one's.
  await boss.schedule(QUEUES.contractSweep, config.nightlyCron, {}, { tz: "UTC" });
  await boss.schedule(QUEUES.summaryRollup, shiftCron(config.nightlyCron, 15), {}, { tz: "UTC" });

  // The digest runs after both, so "what happened yesterday" includes the
  // contracts that expired overnight.
  await boss.schedule(QUEUES.notificationDigest, config.digestCron, {}, { tz: "UTC" });
  await boss.schedule(QUEUES.monthlyReport, config.monthlyReportCron, {}, { tz: "UTC" });

  console.info(
    `[worker] up — nightly "${config.nightlyCron}", digest "${config.digestCron}", ` +
      `monthly "${config.monthlyReportCron}" (UTC)`,
  );

  const shutdown = async (signal: string) => {
    console.info(`[worker] ${signal}, stopping`);
    await boss.stop({ graceful: true });
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
