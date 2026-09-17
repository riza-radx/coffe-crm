/**
 * Fixed-point money arithmetic on BigInt minor units.
 *
 * Money never becomes a JavaScript number anywhere on this path: `0.1 * 0.7` is
 * not 0.07 in IEEE 754, and a commission is paid out to somebody. Amounts and
 * percentages arrive as fixed-scale strings (validated in lib/validation/decimal),
 * are parsed into integers, multiplied exactly, and formatted back to a string —
 * which is also what Prisma writes into a `Decimal` column.
 */

/** Both `bills.amount` and `contracts.commission_percentage` are scale 2. */
export const MONEY_SCALE = 2;

/** "120000.00" (scale 2) -> 12000000n. Rejects signs, exponents and extra decimals. */
export function parseFixed(value: string, scale = MONEY_SCALE): bigint {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) throw new TypeError(`Not a fixed-point decimal: ${value}`);
  const fraction = match[2] ?? "";
  if (fraction.length > scale) throw new TypeError(`More than ${scale} decimals: ${value}`);
  return BigInt(match[1] + fraction.padEnd(scale, "0"));
}

/** 900000n -> "9000.00". The only way a bigint leaves this module. */
export function formatFixed(units: bigint, scale = MONEY_SCALE): string {
  if (units < 0n) throw new RangeError("negative money");
  const digits = units.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** 100 (percent) × 100 (the percentage's own scale). */
const PERCENT_DIVISOR = 10_000n;

/**
 * amount (scale 2) × percentage (scale 2) -> amount (scale 2), ROUND HALF UP.
 *
 * The product is computed exactly in BigInt before the single division, so there
 * is no intermediate rounding. Half-up matches Postgres `numeric` rounding, so a
 * figure computed here and the same figure computed in SQL agree, and it is the
 * ordinary commercial convention for a payout.
 */
export function mulPercentHalfUp(amountUnits: bigint, percentUnits: bigint): bigint {
  if (amountUnits < 0n || percentUnits < 0n) throw new RangeError("negative money");
  const product = amountUnits * percentUnits;
  const quotient = product / PERCENT_DIVISOR;
  const remainder = product % PERCENT_DIVISOR;
  // Both operands are non-negative, so half-up and half-away-from-zero coincide.
  return remainder * 2n >= PERCENT_DIVISOR ? quotient + 1n : quotient;
}

export function sumFixed(values: readonly string[], scale = MONEY_SCALE): string {
  return formatFixed(
    values.reduce((total, value) => total + parseFixed(value, scale), 0n),
    scale,
  );
}
