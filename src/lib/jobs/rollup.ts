import { prisma } from "@/lib/db";
import { buildRevenueGroupSql, type RawRevenueRow } from "@/lib/queries/analytics-sql";
import { periodRange } from "@/lib/validation/period";

/**
 * The nightly aggregate of section 9: revenue per client per month and commission
 * totals per rep per month, written into `revenue_summaries` so a dashboard need
 * not aggregate the whole bill table on every load.
 *
 * The rollup deliberately reuses `buildRevenueGroupSql` — the same builder the
 * live analytics use. A separate query here would be a second definition of
 * "revenue", free to drift from the first one by a VOID bill or a join; sharing
 * the builder makes the summary and the live figure the same statement over the
 * same month, differing only in when they ran.
 */
export const ROLLUP_GROUP_LIMIT = 100_000;

export type RollupResult = {
  month: string;
  clients: number;
  reps: number;
};

/** `YYYY-MM` → the first of that month, UTC. */
function monthStart(month: string): Date {
  return periodRange(month).gte;
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The month before the one `now` falls in, and the current one. */
export function monthsToRoll(now: Date = new Date()): string[] {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [monthKey(previous), monthKey(current)];
}

type CommissionGroup = {
  salesUserId: string;
  _sum: { commissionAmount: { toFixed(dp: number): string } | null };
  _count: { _all: number };
};

export async function rollupMonth(month: string): Promise<RollupResult> {
  const range = periodRange(month);
  const periodMonth = monthStart(month);

  const byClient = buildRevenueGroupSql({
    groupBy: "client",
    range,
    ownerId: null,
    limit: ROLLUP_GROUP_LIMIT,
  });
  const byRep = buildRevenueGroupSql({
    groupBy: "salesRep",
    range,
    ownerId: null,
    limit: ROLLUP_GROUP_LIMIT,
  });

  const [clientRows, repRows, commissionRows] = (await Promise.all([
    prisma.$queryRawUnsafe(byClient.text, ...byClient.values),
    prisma.$queryRawUnsafe(byRep.text, ...byRep.values),
    prisma.commission.groupBy({
      by: ["salesUserId"],
      where: { bill: { billDate: range, status: { not: "VOID" } } },
      _sum: { commissionAmount: true },
      _count: { _all: true },
    }),
  ])) as [RawRevenueRow[], RawRevenueRow[], CommissionGroup[]];

  const commissions = new Map(
    commissionRows.map((row) => [
      row.salesUserId,
      {
        amount: row._sum.commissionAmount ? row._sum.commissionAmount.toFixed(2) : "0.00",
        count: row._count._all,
      },
    ]),
  );

  // A rep with commissions but no revenue rows cannot happen (a commission exists
  // only for a verified bill), but a rep whose bills were all voided can — so the
  // rep set is the union rather than the revenue rows alone.
  const repKeys = new Set<string>([
    ...repRows.map((row) => row.key),
    ...commissions.keys(),
  ]);

  await prisma.$transaction(async (tx) => {
    for (const row of clientRows) {
      await tx.revenueSummary.upsert({
        where: {
          grain_subjectId_periodMonth: { grain: "CLIENT", subjectId: row.key, periodMonth },
        },
        create: {
          grain: "CLIENT",
          subjectId: row.key,
          periodMonth,
          revenue: row.revenue ?? "0",
          billCount: row.bill_count,
          computedAt: new Date(),
        },
        update: {
          revenue: row.revenue ?? "0",
          billCount: row.bill_count,
          computedAt: new Date(),
        },
      });
    }

    const revenueByRep = new Map(repRows.map((row) => [row.key, row]));
    for (const key of repKeys) {
      const revenue = revenueByRep.get(key);
      const commission = commissions.get(key);
      const values = {
        revenue: revenue?.revenue ?? "0",
        billCount: revenue?.bill_count ?? 0,
        commissionAmount: commission?.amount ?? "0",
        commissionCount: commission?.count ?? 0,
        computedAt: new Date(),
      };
      await tx.revenueSummary.upsert({
        where: {
          grain_subjectId_periodMonth: { grain: "SALES_REP", subjectId: key, periodMonth },
        },
        create: { grain: "SALES_REP", subjectId: key, periodMonth, ...values },
        update: values,
      });
    }
  });

  return { month, clients: clientRows.length, reps: repKeys.size };
}

export async function rollupRecentMonths(now: Date = new Date()): Promise<RollupResult[]> {
  const results: RollupResult[] = [];
  // Last month is rolled again alongside this one: a bill entered late, or a
  // dispute resolved on the 2nd, changes a month that is already "closed".
  for (const month of monthsToRoll(now)) results.push(await rollupMonth(month));
  return results;
}
