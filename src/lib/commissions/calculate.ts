import { unprocessable } from "@/lib/api/errors";
import type { DecimalString } from "@/lib/api/decimal";
import { formatFixed, mulPercentHalfUp, parseFixed } from "@/lib/money/fixed-point";

/** `commissions.commission_amount` is Decimal(14,2) → 999999999999.99 at most. */
export const MAX_COMMISSION_UNITS = 99_999_999_999_999n;

export type CommissionCalculation = {
  baseAmount: DecimalString;
  commissionPercentageSnapshot: DecimalString;
  commissionAmount: DecimalString;
};

/**
 * Section 6 of the technical plan:
 *
 *   commission_amount = bill.amount × contract.commission_percentage
 *
 * A pure function, and the only place the formula exists. It returns the snapshot
 * alongside the amount so the caller persists both from one object — a commission
 * row can never be written with an amount from one percentage and a snapshot from
 * another, and nothing later recomputes it from the live contract.
 */
export function calculateCommission(input: {
  amount: DecimalString;
  percentage: DecimalString;
}): CommissionCalculation {
  const amountUnits = parseFixed(input.amount);
  const percentUnits = parseFixed(input.percentage);
  const commissionUnits = mulPercentHalfUp(amountUnits, percentUnits);

  if (commissionUnits > MAX_COMMISSION_UNITS) {
    throw unprocessable("COMMISSION_OVERFLOW", { amount: input.amount, percentage: input.percentage });
  }

  return {
    baseAmount: formatFixed(amountUnits),
    commissionPercentageSnapshot: formatFixed(percentUnits),
    commissionAmount: formatFixed(commissionUnits),
  };
}
