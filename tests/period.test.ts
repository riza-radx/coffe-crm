import { describe, expect, it } from "vitest";
import {
  AnalyticsPeriodSchema,
  MonthPeriodSchema,
  parsePeriod,
  periodRange,
} from "@/lib/validation/period";
import { PeriodSchema } from "@/lib/validation/commissions";
import { RevenueQuerySchema, ANALYTICS_MAX_RANGE_DAYS } from "@/lib/validation/analytics";

const iso = (date: Date) => date.toISOString();

describe("periodRange", () => {
  it("resolves a month to [first, next first) in UTC", () => {
    expect(periodRange("2026-09")).toEqual({
      gte: new Date("2026-09-01T00:00:00.000Z"),
      lt: new Date("2026-10-01T00:00:00.000Z"),
    });
  });

  // The rewrite replaced a hand-written December wrap-around with Date.UTC's own
  // month overflow. This is the case that would break if that were wrong.
  it("rolls December into the next January", () => {
    const range = periodRange("2026-12");
    expect(iso(range.gte)).toBe("2026-12-01T00:00:00.000Z");
    expect(iso(range.lt)).toBe("2027-01-01T00:00:00.000Z");
  });

  it("resolves each quarter, including Q4 across the year boundary", () => {
    expect(iso(periodRange("2026-Q1").gte)).toBe("2026-01-01T00:00:00.000Z");
    expect(iso(periodRange("2026-Q1").lt)).toBe("2026-04-01T00:00:00.000Z");
    expect(iso(periodRange("2026-Q3").gte)).toBe("2026-07-01T00:00:00.000Z");
    expect(iso(periodRange("2026-Q4").lt)).toBe("2027-01-01T00:00:00.000Z");
  });

  it("resolves a bare year to the whole year", () => {
    expect(iso(periodRange("2026").gte)).toBe("2026-01-01T00:00:00.000Z");
    expect(iso(periodRange("2026").lt)).toBe("2027-01-01T00:00:00.000Z");
  });

  it("reports the kind it parsed", () => {
    expect(parsePeriod("2026").kind).toBe("year");
    expect(parsePeriod("2026-Q2").kind).toBe("quarter");
    expect(parsePeriod("2026-02").kind).toBe("month");
  });
});

describe("period schemas", () => {
  it("accepts month, quarter and year for analytics, normalizing a lowercase q", () => {
    expect(AnalyticsPeriodSchema.parse("2026")).toBe("2026");
    expect(AnalyticsPeriodSchema.parse("2026-09")).toBe("2026-09");
    expect(AnalyticsPeriodSchema.parse("2026-q3")).toBe("2026-Q3");
  });

  it("rejects impossible periods", () => {
    for (const bad of ["2026-13", "2026-00", "2026-Q5", "2026-Q0", "26-09", "2026-9", ""]) {
      expect(AnalyticsPeriodSchema.safeParse(bad).success).toBe(false);
    }
  });

  /**
   * The Phase 3 schema deliberately did NOT widen: it is shared with batch
   * approval, where a period is the blast radius of one click.
   */
  it("keeps the commission period month-only", () => {
    expect(PeriodSchema.safeParse("2026-09").success).toBe(true);
    expect(PeriodSchema.safeParse("2026-Q3").success).toBe(false);
    expect(PeriodSchema.safeParse("2026").success).toBe(false);
    expect(MonthPeriodSchema.safeParse("2026-Q3").success).toBe(false);
  });
});

describe("revenue query bounds", () => {
  const base = { groupBy: "month", from: "2026-01-01", to: "2026-03-31" };

  it("requires an explicit window", () => {
    expect(RevenueQuerySchema.safeParse({ groupBy: "month" }).success).toBe(false);
    expect(RevenueQuerySchema.safeParse({ groupBy: "month", from: "2026-01-01" }).success).toBe(false);
  });

  it("rejects a reversed range", () => {
    expect(
      RevenueQuerySchema.safeParse({ ...base, from: "2026-03-31", to: "2026-01-01" }).success,
    ).toBe(false);
  });

  it(`allows exactly ${ANALYTICS_MAX_RANGE_DAYS} days and rejects one more`, () => {
    // 2026-01-01 → 2028-01-01 inclusive is 731 days: two whole calendar years,
    // which is the widest window a month-grouped chart should ever plot.
    expect(RevenueQuerySchema.safeParse({ ...base, to: "2028-01-01" }).success).toBe(true);
    expect(RevenueQuerySchema.safeParse({ ...base, to: "2028-01-02" }).success).toBe(false);
  });

  it("defaults and caps the limit", () => {
    expect(RevenueQuerySchema.parse(base).limit).toBe(100);
    expect(RevenueQuerySchema.safeParse({ ...base, limit: "999" }).success).toBe(false);
    expect(RevenueQuerySchema.parse({ ...base, limit: "10" }).limit).toBe(10);
  });

  it("rejects an unknown grouping", () => {
    expect(RevenueQuerySchema.safeParse({ ...base, groupBy: "country" }).success).toBe(false);
  });
});
