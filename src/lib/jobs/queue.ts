import { PgBoss } from "pg-boss";
import { config } from "@/lib/env";

/**
 * Section 1 puts commission recalculation, expiry checks and notification email
 * on pg-boss, "so bill creation stays fast". This module is the send side, used
 * from the request path; the work side lives in src/worker.
 *
 * Two rules hold here:
 *
 *  - Nothing is enqueued *inside* a transaction. A job row committed by pg-boss's
 *    own connection would survive a rollback of the mutation that created it, so
 *    callers enqueue after the commit returns.
 *  - Enqueueing never fails a request. A commission approval that is already
 *    committed must not turn into a 500 because the queue was unreachable; the
 *    failure is logged and the in-app notification still stands.
 */
export const QUEUES = {
  notificationEmail: "notifications.email",
  contractSweep: "contracts.daily-sweep",
  summaryRollup: "summaries.nightly-rollup",
  // Phase 6
  notificationDigest: "notifications.daily-digest",
  monthlyReport: "reports.monthly",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type NotificationEmailJob = { notificationId: string };

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

export function createBoss(): PgBoss {
  return new PgBoss({
    connectionString: process.env.DATABASE_URL,
    schema: process.env.PGBOSS_SCHEMA || "pgboss",
  });
}

/** Lazily started, send-only instance for the web process. */
async function sender(): Promise<PgBoss | null> {
  if (!config.jobsEnabled) return null;
  if (boss) return boss;
  starting ??= (async () => {
    const instance = createBoss();
    await instance.start();
    for (const name of Object.values(QUEUES)) await instance.createQueue(name);
    boss = instance;
    return instance;
  })();
  return starting;
}

/** Fire-and-forget. Returns the job id, or null when the queue was unavailable. */
export async function enqueue(name: QueueName, data: object): Promise<string | null> {
  try {
    const instance = await sender();
    if (!instance) return null;
    return await instance.send(name, data);
  } catch (error) {
    console.error(`[jobs] could not enqueue ${name}:`, error);
    starting = null;
    boss = null;
    return null;
  }
}

/**
 * Called after a mutation's transaction commits, with the ids writeNotifications
 * returned. Awaiting it is optional — a caller that does not want to wait for the
 * queue can let it settle on its own.
 */
export async function enqueueNotificationEmails(ids: readonly string[]): Promise<void> {
  for (const notificationId of ids) {
    await enqueue(QUEUES.notificationEmail, { notificationId } satisfies NotificationEmailJob);
  }
}

/** Tests and the worker's own shutdown path. */
export async function stopQueue(): Promise<void> {
  const instance = boss;
  boss = null;
  starting = null;
  if (instance) await instance.stop({ graceful: true });
}
