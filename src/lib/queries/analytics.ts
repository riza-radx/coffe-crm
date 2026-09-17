import "server-only";
import { prisma } from "@/lib/db";
import { toDecimalString, type DecimalString } from "@/lib/api/decimal";
import { parseFixed, sumFixed } from "@/lib/money/fixed-point";
import { permissionFor } from "@/lib/rbac";
import type { Actor } from "@/lib/rbac/types";
import { toDateOnly } from "@/lib/validation/common";
import { periodRange } from "@/lib/validation/period";
import {
  LEADERBOARD_MAX_REPS,
  type LeaderboardQuery,
  type RevenueGroupBy,
  type RevenueQuery,
} from "@/lib/validation/analytics";
import {
  buildRevenueGroupSql,
  buildRevenueTotalSql,
  type RawRevenueRow,
} from "./analytics-sql";
import { commissionScopeWhere } from "./commissions";

type Decimalish = { toFixed(dp: number): string };

export type LeaderboardEntry = {
  rank: number;
  salesUser: { id: string; name: string };
  revenue: DecimalString;
  commission: DecimalString;
  billCount: number;
  commissionCount: number;
};

export type Leaderboard = {
  period: string;
  range: { from: string; to: string };
  /** "all" = the full ranked board. "own" = one row, the caller's. */
  scope: "all" | "own";
  totalReps: number;
  rows: LeaderboardEntry[];
  /** The "#3 of 8" an Outside Sales rep sees. Null when they billed nothing. */
  self: { rank: number; of: number } | null;
};

export type RevenueBucket = {
  key: string;
  label: string;
  revenue: DecimalString;
  billCount: number;
};

export type RevenueReport = {
  groupBy: RevenueGroupBy;
  range: { from: string; to: string };
  scope: "all" | "own";
  rows: RevenueBucket[];
  limit: number;
  truncated: boolean;
  /** Over the whole filtered set — NOT the sum of `rows` when truncated. */
  total: { revenue: DecimalString; billCount: number };
};

export type CommissionSummary = {
  scope: "all" | "own";
  byStatus: Record<"PENDING" | "APPROVED" | "PAID", { count: number; amount: DecimalString }>;
  total: { count: number; amount: DecimalString };
};

const ZERO = "0.00";
const COMMISSION_STATUSES = ["PENDING", "APPROVED", "PAID"] as const;

/* ------------------------------------------------------------------ */
/* Leaderboard                                                         */
/* ------------------------------------------------------------------ */

/**
 * GET /api/analytics/leaderboard
 *
 * The board is computed over every rep and then redacted for the caller. The
 * alternative — querying only the caller's own totals and deriving their rank
 * with a COUNT — would put the ranking rule in two places, and the day the two
 * disagree an Outside Sales rep is told "#3 of 8" while the admin's screen shows
 * them fourth. One ranking implementation, one redaction point, one test.
 */
export async function getLeaderboard(actor: Actor, query: LeaderboardQuery): Promise<Leaderboard> {
  const range = periodRange(query.period);

  const [revenueRows, commissionGroups] = await Promise.all([
    // ownerId: null — deliberately unscoped. A rank has no meaning without every
    // rep's figure; `redactForScope` below is the only path to a response.
    queryRevenue({ groupBy: "salesRep", range, ownerId: null, limit: LEADERBOARD_MAX_REPS }),
    prisma.commission.groupBy({
      by: ["salesUserId"],
      // The bill's date, not the commission's created_at — the Phase 3 rule.
      where: { bill: { billDate: range } },
      _sum: { commissionAmount: true },
      _count: { _all: true },
      // `take` on a groupBy needs an explicit orderBy — Prisma otherwise falls back
      // to the model's `id`, which isn't in `by` (P2019). Ordering by the aggregate
      // also makes the cut-off the intended one: the top reps, not an arbitrary N.
      orderBy: { _sum: { commissionAmount: "desc" } },
      take: LEADERBOARD_MAX_REPS,
    }),
  ]);

  const revenueByUser = new Map(revenueRows.map((row) => [row.key, row]));
  const commissionByUser = new Map(
    (commissionGroups as Array<{
      salesUserId: string;
      _sum: { commissionAmount: Decimalish | null };
      _count: { _all: number };
    }>).map((group) => [group.salesUserId, group]),
  );

  const ids = [...new Set([...revenueByUser.keys(), ...commissionByUser.keys()])];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u: { id: string; name: string }) => [u.id, u.name]));

  const unranked = ids.map((id) => {
    const revenue = revenueByUser.get(id);
    const commission = commissionByUser.get(id);
    return {
      salesUser: { id, name: nameById.get(id) ?? id },
      revenue: toDecimalString(revenue?.revenue ?? "0"),
      commission: toDecimalString(commission?._sum.commissionAmount ?? "0"),
      billCount: revenue?.bill_count ?? 0,
      commissionCount: commission?._count._all ?? 0,
    };
  });

  // Revenue, then commission, then name: a total order, so `rank = index + 1`
  // needs no tie rule and two runs never disagree. Money compares as BigInt.
  unranked.sort(
    (a, b) =>
      compareMoney(b.revenue, a.revenue) ||
      compareMoney(b.commission, a.commission) ||
      a.salesUser.name.localeCompare(b.salesUser.name),
  );

  const ranked: LeaderboardEntry[] = unranked.map((entry, index) => ({ rank: index + 1, ...entry }));

  return redactForScope(actor, ranked, {
    period: query.period,
    range: { from: toDateOnly(range.gte), to: toDateOnly(new Date(range.lt.getTime() - 1)) },
  });
}

/**
 * "View full leaderboard" — Yes / Yes / No (own stats + own rank only, no other
 * rep's name or figures).
 *
 * `permissionFor(...).scope`, not `can(...)`: they agree for today's matrix row,
 * but if that cell ever became "own", `can()` would silently hand Outside Sales
 * the whole board while this check keeps it redacted.
 *
 * The redacted row is a freshly built object in a fresh array — never the full
 * list with keys deleted, which is how a later added field leaks.
 */
function redactForScope(
  actor: Actor,
  ranked: LeaderboardEntry[],
  meta: { period: string; range: { from: string; to: string } },
): Leaderboard {
  const full = permissionFor(actor, "viewFull", "leaderboard").scope === "all";
  const index = ranked.findIndex((entry) => entry.salesUser.id === actor.id);
  const self = index >= 0 ? { rank: ranked[index].rank, of: ranked.length } : null;

  if (full) {
    return { ...meta, scope: "all", totalReps: ranked.length, rows: ranked, self };
  }

  const own =
    index >= 0
      ? ranked[index]
      : // A rep with no activity in the period is not on the board at all. They see
        // a zero row and no rank, while `totalReps` still reports the real field.
        {
          rank: ranked.length + 1,
          salesUser: { id: actor.id, name: "" },
          revenue: ZERO,
          commission: ZERO,
          billCount: 0,
          commissionCount: 0,
        };

  return {
    ...meta,
    scope: "own",
    totalReps: ranked.length,
    rows: [
      {
        rank: own.rank,
        salesUser: { id: own.salesUser.id, name: own.salesUser.name },
        revenue: own.revenue,
        commission: own.commission,
        billCount: own.billCount,
        commissionCount: own.commissionCount,
      },
    ],
    self,
  };
}

/* ------------------------------------------------------------------ */
/* Revenue                                                             */
/* ------------------------------------------------------------------ */

/**
 * GET /api/analytics/revenue
 *
 * A bill has no visibility rule of its own — it inherits its contract's, which is
 * what the bills list already does. So the scope predicate is `sales_owner_id`
 * for all three groupings, including `groupBy=client`: scoping on
 * `clients.acquired_by` instead would show a rep revenue from contracts they do
 * not own and hide revenue on contracts they do, and the figure would then agree
 * with no other screen in the app.
 */
export async function getRevenueReport(actor: Actor, query: RevenueQuery): Promise<RevenueReport> {
  const { scope } = permissionFor(actor, "viewAll", "contract");
  const ownerId = scope === "all" ? null : scope === "own" ? actor.id : "__denied__";

  const range = { gte: toUtc(query.from), lt: nextDay(query.to) };

  const [rows, totals] = await Promise.all([
    queryRevenue({ groupBy: query.groupBy, range, ownerId, limit: query.limit }),
    prisma.$queryRawUnsafe<Array<{ revenue: string | null; bill_count: number }>>(
      ...spread(buildRevenueTotalSql({ range, ownerId })),
    ),
  ]);

  const truncated = rows.length > query.limit;
  const page = truncated ? rows.slice(0, query.limit) : rows;
  const labels = await labelsFor(query.groupBy, page.map((row) => row.key));

  return {
    groupBy: query.groupBy,
    range: { from: query.from, to: query.to },
    scope: scope === "all" ? "all" : "own",
    rows: page.map((row) => ({
      key: row.key,
      label: labels.get(row.key) ?? row.key,
      revenue: toDecimalString(row.revenue ?? "0"),
      billCount: row.bill_count,
    })),
    limit: query.limit,
    truncated,
    total: {
      revenue: toDecimalString(totals[0]?.revenue ?? "0"),
      billCount: totals[0]?.bill_count ?? 0,
    },
  };
}

async function labelsFor(groupBy: RevenueGroupBy, keys: string[]): Promise<Map<string, string>> {
  // A month key is its own label; the other two are ids that need a name.
  if (groupBy === "month" || keys.length === 0) return new Map();

  const rows =
    groupBy === "client"
      ? await prisma.client.findMany({ where: { id: { in: keys } }, select: { id: true, name: true } })
      : await prisma.user.findMany({ where: { id: { in: keys } }, select: { id: true, name: true } });

  return new Map(rows.map((row: { id: string; name: string }) => [row.id, row.name]));
}

/* ------------------------------------------------------------------ */
/* Commission summary                                                  */
/* ------------------------------------------------------------------ */

/**
 * GET /api/analytics/commissions/summary — the same scope as GET /api/commissions,
 * enforced by importing that module's filter rather than restating the rule.
 */
export async function getCommissionSummary(actor: Actor): Promise<CommissionSummary> {
  const where = commissionScopeWhere(actor);

  const grouped = (await prisma.commission.groupBy({
    by: ["status"],
    where,
    _sum: { commissionAmount: true },
    _count: { _all: true },
  })) as Array<{
    status: string;
    _sum: { commissionAmount: Decimalish | null };
    _count: { _all: number };
  }>;

  // Every status is present whether or not the database returned it, so the
  // dashboard renders a constant shape with no null handling.
  const byStatus = Object.fromEntries(
    COMMISSION_STATUSES.map((status) => [status, { count: 0, amount: ZERO }]),
  ) as CommissionSummary["byStatus"];

  for (const group of grouped) {
    if (!(group.status in byStatus)) continue;
    byStatus[group.status as (typeof COMMISSION_STATUSES)[number]] = {
      count: group._count._all,
      amount: toDecimalString(group._sum.commissionAmount ?? "0"),
    };
  }

  const { scope } = permissionFor(actor, "viewAll", "commission");

  return {
    scope: scope === "all" ? "all" : "own",
    byStatus,
    total: {
      count: COMMISSION_STATUSES.reduce((sum, status) => sum + byStatus[status].count, 0),
      // BigInt addition — money is never summed with `+` on numbers.
      amount: sumFixed(COMMISSION_STATUSES.map((status) => byStatus[status].amount)),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function queryRevenue(params: Parameters<typeof buildRevenueGroupSql>[0]) {
  return prisma.$queryRawUnsafe<RawRevenueRow[]>(...spread(buildRevenueGroupSql(params)));
}

/** `$queryRawUnsafe(text, ...values)` from a built statement. */
function spread(sql: { text: string; values: unknown[] }): [string, ...unknown[]] {
  return [sql.text, ...sql.values];
}

function compareMoney(a: DecimalString, b: DecimalString): number {
  const left = parseFixed(a);
  const right = parseFixed(b);
  return left === right ? 0 : left < right ? -1 : 1;
}

function toUtc(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/** `to` is inclusive for the reader, so the half-open bound is the next midnight. */
function nextDay(dateOnly: string): Date {
  return new Date(toUtc(dateOnly).getTime() + 24 * 60 * 60 * 1000);
}
