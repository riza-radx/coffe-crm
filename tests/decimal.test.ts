import { describe, expect, it } from "vitest";
import { toDecimalString } from "@/lib/api/decimal";
import { BillAmountSchema, CommissionPercentageSchema, decimalString } from "@/lib/validation/decimal";

/** Stand-in for a Prisma Decimal: decimal.js exposes the same toFixed. */
const decimal = (value: string) => ({
  toFixed: (dp: number) => Number(value).toFixed(dp),
});

describe("toDecimalString", () => {
  it("keeps the scale that toString would drop", () => {
    expect(toDecimalString(decimal("12.50"))).toBe("12.50");
    expect(toDecimalString(decimal("7.5"))).toBe("7.50");
    expect(toDecimalString(decimal("100"))).toBe("100.00");
  });

  it("handles plain numbers and strings", () => {
    expect(toDecimalString(7.5)).toBe("7.50");
    expect(toDecimalString("0")).toBe("0.00");
    expect(toDecimalString("120000.4")).toBe("120000.40");
  });

  it("never loses the integer digits of a Decimal(14,2) amount", () => {
    expect(toDecimalString("999999999999.99")).toBe("999999999999.99");
  });

  it("refuses something that is not a decimal", () => {
    expect(() => toDecimalString("abc")).toThrow(TypeError);
  });
});

describe("the decimal schema shared by the form and the route handler", () => {
  const schema = decimalString(3, 2);

  it("accepts values that fit the column", () => {
    for (const value of ["0", "7", "7.5", "7.50", "100.00", "999.99"]) {
      expect(schema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects values Postgres would reject", () => {
    for (const value of ["1000.00", "1.234", "-1", "", "1e3", "7,50", "abc"]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });

  it("bounds a commission percentage to 0–100", () => {
    expect(CommissionPercentageSchema.safeParse("100.00").success).toBe(true);
    expect(CommissionPercentageSchema.safeParse("0").success).toBe(true);
    expect(CommissionPercentageSchema.safeParse("100.01").success).toBe(false);
    expect(CommissionPercentageSchema.safeParse("101").success).toBe(false);
  });

  it("requires a bill amount above zero", () => {
    expect(BillAmountSchema.safeParse("0").success).toBe(false);
    expect(BillAmountSchema.safeParse("0.01").success).toBe(true);
    expect(BillAmountSchema.safeParse("999999999999.99").success).toBe(true);
    expect(BillAmountSchema.safeParse("1000000000000.00").success).toBe(false);
  });
});
