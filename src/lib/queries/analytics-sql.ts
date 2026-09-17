import type { RevenueGroupBy } from "@/lib/validation/analytics";

/**
 * The revenue SQL, built as a pure function.
 *
 * Revenue is attributed through `bills.contract_id -> contracts.sales_owner_id`;
 * `bills` has no rep column, so Prisma's `groupBy` (whose `by` takes scalars of
 * the model only) cannot express revenue per rep or per month-with-a-join. This
 * module is therefore the one place that writes SQL by hand — and being pure, with
 * no database import, it can be tested directly: the assertion that a rep's id
 * lands in the WHERE clause is made against the statement itself, not against a
 * mock that could be wrong in the same direction as the code.
 *
 * Nothing caller-controlled reaches the statement text. The three grouping
 * expressions are module constants selected by a Zod enum; every value —
 * including the limit — is a `$n` parameter.
 */

export type BuiltSql = { text: string; values: unknown[] };

export type RevenueSqlParams = {
  groupBy: RevenueGroupBy;
  range: { gte: Date; lt: Date };
  /** null = unscoped (Super Admin, and the leaderboard's deliberate full read). */
  ownerId: string | null;
  limit: number;
};

/** Both branches of the money question use the same predicate, so they agree. */
const KEY_EXPR: Record<RevenueGroupBy, string> = {
  client: "b.client_id",
  salesRep: "c.sales_owner_id",
  month: "to_char(date_trunc('month', b.bill_date), 'YYYY-MM')",
};

/**
 * A VOID bill is not revenue. PENDING and DISPUTED bills still are — the same
 * predicate the client and contract detail totals already use, so the analytics
 * figure and the figure on a client's card cannot disagree.
 */
const REVENUE_PREDICATE = "b.status <> 'VOID'";

function params() {
  const values: unknown[] = [];
  return {
    values,
    /** Pushes a value and returns its own placeholder, so $n is never hand-counted. */
    of(value: unknown): string {
      values.push(value);
      return `$${values.length}`;
    },
  };
}

function whereClause(p: ReturnType<typeof params>, { range, ownerId }: Pick<RevenueSqlParams, "range" | "ownerId">) {
  const parts = [
    REVENUE_PREDICATE,
    `b.bill_date >= ${p.of(range.gte)}`,
    `b.bill_date < ${p.of(range.lt)}`,
  ];
  // Scoping is a WHERE predicate, never a post-filter — the same discipline as
  // ownerFilter() in lib/rbac/scope.ts.
  if (ownerId !== null) parts.push(`c.sales_owner_id = ${p.of(ownerId)}`);
  return parts.join("\n   AND ");
}

export function buildRevenueGroupSql({ groupBy, range, ownerId, limit }: RevenueSqlParams): BuiltSql {
  const p = params();
  const where = whereClause(p, { range, ownerId });
  // limit + 1: one row past the cap is how truncation is detected without a
  // second COUNT(DISTINCT ...) query.
  const limitParam = p.of(limit + 1);

  const text = `SELECT ${KEY_EXPR[groupBy]} AS key,
       COALESCE(SUM(b.amount), 0)::text AS revenue,
       COUNT(*)::int AS bill_count
  FROM bills b
  JOIN contracts c ON c.id = b.contract_id
 WHERE ${where}
 GROUP BY 1
 ORDER BY SUM(b.amount) DESC, 1 ASC
 LIMIT ${limitParam}`;

  return { text, values: p.values };
}

/**
 * The grand total over the same WHERE, without GROUP BY or LIMIT — so a truncated
 * top-N still reports an honest total rather than the sum of the rows shown.
 */
export function buildRevenueTotalSql({ range, ownerId }: Omit<RevenueSqlParams, "groupBy" | "limit">): BuiltSql {
  const p = params();
  const where = whereClause(p, { range, ownerId });

  const text = `SELECT COALESCE(SUM(b.amount), 0)::text AS revenue,
       COUNT(*)::int AS bill_count
  FROM bills b
  JOIN contracts c ON c.id = b.contract_id
 WHERE ${where}`;

  return { text, values: p.values };
}

export type RawRevenueRow = { key: string; revenue: string | null; bill_count: number };
