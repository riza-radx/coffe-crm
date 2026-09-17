import "server-only";
import { prisma } from "@/lib/db";
import { toDecimalString, type DecimalString } from "@/lib/api/decimal";
import { permissionFor } from "@/lib/rbac";
import type { Actor } from "@/lib/rbac/types";
import { getRevenueReport } from "./analytics";

/**
 * Phase 6, step 20 — the one performance change the measurement justified.
 *
 * `scripts/benchmark.mjs` on 600k bills: the dashboard's 12-month trend costs
 * 127 ms as a live aggregation and 0.8 ms read from `revenue_summaries`. No
 * candidate index moved that number by more than a few percent, because the
 * query touches most of the table by design — the fix is not to read the table.
 *
 * Two rules keep the fast path honest:
 *
 *  - The current month is always live. It is still changing, and the rollup runs
 *    at night.
 *  - If any closed month in the window has no summary row, the whole window falls
 *    back to the live query. A rollup that has not run yet must show the real
 *    figures, not zeros; and one rule for the whole window beats a series that is
 *    half-summary, half-live and impossible to reason about.
 */
export type TrendPoint = { key: string; revenue: DecimalString; billCount: number };

export type Trend = {
  rows: TrendPoint[];
  /** Over the window, so the tile above the chart and the chart agree by construction. */
  total: { revenue: DecimalString; billCount: number };
  /** "summaries" | "live" — surfaced so a test, and a reader, can tell which ran. */
  source: "summaries" | "live";
};

function totalOf(rows: readonly TrendPoint[]): { revenue: DecimalString; billCount: number } {
  return {
    revenue: formatUnits(
      rows.reduce((sum, row) => sum + BigInt(row.revenue.replace(".", "")), 0n),
    ),
    billCount: rows.reduce((sum, row) => sum + row.billCount, 0),
  };
}

type SummaryRow = {
  periodMonth: Date;
  revenue: { toFixed(dp: number): string };
  billCount: number;
};

export function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The `count` months ending with the one `now` falls in, oldest first. */
export function trendMonths(now: Date, count: number): string[] {
  const keys: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    keys.push(monthKeyOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))));
  }
  return keys;
}

export async function getMonthlyTrend(
  actor: Actor,
  months: number,
  now: Date = new Date(),
): Promise<Trend> {
  const keys = trendMonths(now, months);
  const current = keys[keys.length - 1];
  const closed = keys.slice(0, -1);

  const ownScope = permissionFor(actor, "viewAll", "contract").scope !== "all";
  const grain = ownScope ? "SALES_REP" : "CLIENT";

  const summaries = (await prisma.revenueSummary.findMany({
    where: {
      grain,
      periodMonth: {
        gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1)),
        lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      },
      ...(ownScope ? { subjectId: actor.id } : {}),
    },
    select: { periodMonth: true, revenue: true, billCount: true },
  })) as SummaryRow[];

  const byMonth = new Map<string, { revenue: bigint; billCount: number }>();
  for (const row of summaries) {
    const key = monthKeyOf(row.periodMonth);
    const entry = byMonth.get(key) ?? { revenue: 0n, billCount: 0 };
    entry.revenue += BigInt(row.revenue.toFixed(2).replace(".", ""));
    entry.billCount += row.billCount;
    byMonth.set(key, entry);
  }

  // A rep with no bills in a month has no summary row, and neither does a month
  // the rollup has not covered. They are indistinguishable here, so the decision
  // is made on the months the business had activity in: if the rollup produced
  // nothing at all for a window that should have rows, take the live path.
  const covered = closed.length === 0 || byMonth.size > 0;
  if (!covered) {
    const rows = await live(actor, keys, now);
    return { rows, total: totalOf(rows), source: "live" };
  }

  const summaryRows: TrendPoint[] = closed.map((key) => {
    const entry = byMonth.get(key);
    return {
      key,
      revenue: entry ? formatUnits(entry.revenue) : "0.00",
      billCount: entry?.billCount ?? 0,
    };
  });

  const currentMonth = await live(actor, [current], now);
  const rows = [...summaryRows, ...currentMonth];
  return { rows, total: totalOf(rows), source: "summaries" };
}

/** The Phase 4 path, unchanged — the fallback and the current month both use it. */
async function live(actor: Actor, keys: string[], now: Date): Promise<TrendPoint[]> {
  const first = keys[0];
  const [year, month] = first.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);

  const report = await getRevenueReport(actor, {
    groupBy: "month",
    from,
    to,
    limit: Math.max(keys.length, 1),
  });

  const byKey = new Map(report.rows.map((row) => [row.key, row]));
  return keys.map((key) => ({
    key,
    revenue: toDecimalString(byKey.get(key)?.revenue ?? "0"),
    billCount: byKey.get(key)?.billCount ?? 0,
  }));
}

function formatUnits(units: bigint): DecimalString {
  const digits = units.toString().padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}` as DecimalString;
}
