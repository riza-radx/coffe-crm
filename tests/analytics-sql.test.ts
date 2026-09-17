import { describe, expect, it } from "vitest";
import { buildRevenueGroupSql, buildRevenueTotalSql } from "@/lib/queries/analytics-sql";
import type { RevenueGroupBy } from "@/lib/validation/analytics";

/**
 * The scoping assertion is made against the statement itself, not against a mock.
 * A mock can be wrong in the same direction as the code; the SQL text cannot.
 */
const RANGE = { gte: new Date("2026-01-01T00:00:00Z"), lt: new Date("2026-04-01T00:00:00Z") };
const GROUPINGS: RevenueGroupBy[] = ["client", "salesRep", "month"];

describe("the owner predicate is in the WHERE clause", () => {
  for (const groupBy of GROUPINGS) {
    it(`${groupBy}: a scoped caller's id is a bound parameter`, () => {
      const sql = buildRevenueGroupSql({ groupBy, range: RANGE, ownerId: "u-OUTSIDE_SALES", limit: 10 });
      expect(sql.text).toContain("c.sales_owner_id = $");
      expect(sql.values).toContain("u-OUTSIDE_SALES");
    });

    it(`${groupBy}: an unscoped caller gets no owner predicate at all`, () => {
      const sql = buildRevenueGroupSql({ groupBy, range: RANGE, ownerId: null, limit: 10 });
      expect(sql.text).not.toContain("sales_owner_id =");
    });
  }

  it("the same predicate guards the grand total, so rows and total agree", () => {
    const total = buildRevenueTotalSql({ range: RANGE, ownerId: "u-SALES" });
    expect(total.text).toContain("c.sales_owner_id = $");
    expect(total.values).toContain("u-SALES");
    expect(total.text).not.toContain("GROUP BY");
    expect(total.text).not.toContain("LIMIT");
  });
});

describe("the statement itself", () => {
  it("never interpolates a value into the text", () => {
    const sql = buildRevenueGroupSql({
      groupBy: "client",
      range: RANGE,
      ownerId: "u-'; DROP TABLE bills; --",
      limit: 10,
    });
    expect(sql.text).not.toContain("DROP TABLE");
    expect(sql.values).toContain("u-'; DROP TABLE bills; --");
  });

  it("numbers its parameters in order, with no gaps", () => {
    const sql = buildRevenueGroupSql({ groupBy: "month", range: RANGE, ownerId: "u1", limit: 5 });
    const used = [...sql.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    expect(used).toEqual([1, 2, 3, 4]);
    expect(sql.values).toHaveLength(4);
  });

  it("excludes VOID bills — the same definition of revenue as the detail pages", () => {
    const sql = buildRevenueGroupSql({ groupBy: "client", range: RANGE, ownerId: null, limit: 5 });
    expect(sql.text).toContain("b.status <> 'VOID'");
    expect(sql.text).toContain("JOIN contracts c ON c.id = b.contract_id");
  });

  it("asks for one row past the limit, which is how truncation is detected", () => {
    const sql = buildRevenueGroupSql({ groupBy: "client", range: RANGE, ownerId: null, limit: 25 });
    expect(sql.values.at(-1)).toBe(26);
  });

  it("casts the sum to text and the count to int", () => {
    // Un-cast, `numeric` round-trips through the driver and `count` arrives as a
    // BigInt that JSON.stringify throws on.
    const sql = buildRevenueGroupSql({ groupBy: "client", range: RANGE, ownerId: null, limit: 5 });
    expect(sql.text).toContain("::text");
    expect(sql.text).toContain("COUNT(*)::int");
    expect(sql.text).toContain("COALESCE(SUM(b.amount), 0)");
  });

  it("groups each dimension by its own expression", () => {
    expect(buildRevenueGroupSql({ groupBy: "client", range: RANGE, ownerId: null, limit: 5 }).text)
      .toContain("b.client_id AS key");
    expect(buildRevenueGroupSql({ groupBy: "salesRep", range: RANGE, ownerId: null, limit: 5 }).text)
      .toContain("c.sales_owner_id AS key");
    expect(buildRevenueGroupSql({ groupBy: "month", range: RANGE, ownerId: null, limit: 5 }).text)
      .toContain("date_trunc('month', b.bill_date)");
  });
});
