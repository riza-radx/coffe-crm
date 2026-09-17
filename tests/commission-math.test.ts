import { describe, expect, it } from "vitest";
import { formatFixed, mulPercentHalfUp, parseFixed, sumFixed } from "@/lib/money/fixed-point";
import { calculateCommission, MAX_COMMISSION_UNITS } from "@/lib/commissions/calculate";

const commission = (amount: string, percentage: string) =>
  calculateCommission({ amount, percentage }).commissionAmount;

describe("commission formula — commission = amount × percentage", () => {
  it("computes the plan's worked example", () => {
    expect(commission("120000.00", "7.50")).toBe("9000.00");
  });

  it("returns the base amount and the snapshot alongside it, so both are written together", () => {
    expect(calculateCommission({ amount: "120000.00", percentage: "7.5" })).toEqual({
      baseAmount: "120000.00",
      commissionPercentageSnapshot: "7.50",
      commissionAmount: "9000.00",
    });
  });

  it("treats 7.5 and 7.50 as the same percentage", () => {
    expect(commission("1000.00", "7.5")).toBe(commission("1000.00", "7.50"));
  });

  it("returns the amount unchanged at 100%", () => {
    expect(commission("4321.99", "100.00")).toBe("4321.99");
  });
});

describe("edge cases: zero, near-zero and a discounted percentage", () => {
  it("a zero percentage earns nothing", () => {
    expect(commission("120000.00", "0")).toBe("0.00");
    expect(commission("120000.00", "0.00")).toBe("0.00");
  });

  it("a zero bill earns nothing", () => {
    expect(commission("0.00", "7.50")).toBe("0.00");
  });

  it("keeps the smallest payable unit", () => {
    expect(commission("100.00", "0.01")).toBe("0.01");
  });

  it("rounds a sub-cent commission to zero rather than inventing money", () => {
    expect(commission("0.06", "7.50")).toBe("0.00");
  });

  it("a discounted percentage changes the amount and nothing else", () => {
    const full = calculateCommission({ amount: "1000.00", percentage: "10.00" });
    const discounted = calculateCommission({ amount: "1000.00", percentage: "5.00" });
    expect(full.commissionAmount).toBe("100.00");
    expect(discounted.commissionAmount).toBe("50.00");
    expect(discounted.baseAmount).toBe(full.baseAmount);
  });
});

describe("rounding is half-up, applied once, on the final product", () => {
  it("rounds an exact half up", () => {
    // 0.07 × 7.50% = 0.00525 → half a cent, rounded up.
    expect(commission("0.07", "7.50")).toBe("0.01");
  });

  it("rounds just below a half down", () => {
    expect(commission("0.05", "9.00")).toBe("0.00");
  });

  it("handles a non-terminating result", () => {
    expect(commission("33.33", "33.33")).toBe("11.11");
    expect(commission("10.00", "3.33")).toBe("0.33");
  });

  it("keeps precision a float would lose", () => {
    // 0.1 * 0.7 is 0.07000000000000001 in IEEE 754.
    expect(commission("0.70", "10.00")).toBe("0.07");
    expect(commission("1005.00", "1.00")).toBe("10.05");
  });
});

describe("the Decimal(14,2) ceiling", () => {
  it("round-trips the largest storable amount", () => {
    expect(commission("999999999999.99", "100.00")).toBe("999999999999.99");
  });

  it("never returns more than the column can hold", () => {
    expect(parseFixed(commission("999999999999.99", "100.00"))).toBeLessThanOrEqual(
      MAX_COMMISSION_UNITS,
    );
  });
});

describe("fixed-point primitives", () => {
  it("parses and formats without going through a float", () => {
    expect(parseFixed("120000.00")).toBe(12_000_000n);
    expect(parseFixed("7.5")).toBe(750n);
    expect(formatFixed(0n)).toBe("0.00");
    expect(formatFixed(750n)).toBe("7.50");
  });

  it("rejects anything that is not a plain positive fixed-point decimal", () => {
    for (const bad of ["-1", "1.234", "1e3", "7,50", "", "abc", "+5"]) {
      expect(() => parseFixed(bad)).toThrow();
    }
  });

  it("refuses negative money", () => {
    expect(() => mulPercentHalfUp(-1n, 750n)).toThrow();
    expect(() => formatFixed(-1n)).toThrow();
  });

  it("sums a column of amounts exactly", () => {
    expect(sumFixed(["0.10", "0.20", "0.30"])).toBe("0.60");
  });
});
