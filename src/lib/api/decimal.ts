/**
 * Money and percentages cross the JSON boundary as fixed-scale strings, never as
 * numbers: `Decimal(14,2)` amounts lose precision as IEEE doubles, and a Prisma
 * Decimal is a class instance that React's Server Component serializer rejects.
 *
 * `toString()` on a Decimal also drops trailing zeros ("12.50" -> "12.5"), so the
 * scale is always applied explicitly here.
 */
export type DecimalString = string;

export type DecimalLike = { toFixed(dp: number): string };

function isDecimalLike(value: unknown): value is DecimalLike {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as Record<string, unknown>).toFixed === "function";
}

export function toDecimalString(value: DecimalLike | string | number, scale = 2): DecimalString {
  // A plain number satisfies DecimalLike too (it has toFixed), so this one branch
  // covers Prisma Decimals and numbers alike.
  if (isDecimalLike(value)) return value.toFixed(scale);
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new TypeError(`Not a decimal: ${String(value)}`);
  // Re-format through the string so "7.5" becomes "7.50" without going via a float
  // for the significant digits we keep.
  const [int, frac = ""] = String(value).trim().split(".");
  return `${int}.${frac.padEnd(scale, "0").slice(0, scale)}`;
}

/** Percentage of an amount, as a fixed-scale string. Used by Phase 3 for commissions. */
export function formatDecimal(value: DecimalString, locale = "sq-AL"): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
