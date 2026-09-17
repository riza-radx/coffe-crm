import { z } from "zod";

/**
 * A decimal as the user types it and as the wire carries it: a plain string with a
 * bounded number of integer and fractional digits, mirroring the column's
 * `@db.Decimal(precision, scale)` so Postgres can never reject a value that passed
 * validation here. The same schema runs in the browser form and in the route handler.
 */
export function decimalString(integerDigits: number, scale: number) {
  const pattern = new RegExp(`^\\d{1,${integerDigits}}(\\.\\d{1,${scale}})?$`);
  return z
    .string()
    .trim()
    .regex(pattern, {
      error: `Duhet numër pozitiv me deri ${integerDigits} shifra dhe ${scale} dhjetore`,
    });
}

/** contracts.commission_percentage is Decimal(5,2) → 3 integer digits. */
export const CommissionPercentageSchema = decimalString(3, 2).refine(
  (v) => Number(v) >= 0 && Number(v) <= 100,
  { error: "Komisioni duhet midis 0 dhe 100" },
);

/** bills.amount is Decimal(14,2) → 12 integer digits. */
export const BillAmountSchema = decimalString(12, 2).refine((v) => Number(v) > 0, {
  error: "Vlera duhet më e madhe se zero",
});
