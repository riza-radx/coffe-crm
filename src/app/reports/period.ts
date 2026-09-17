/**
 * The reports page works in whole months, because that is the unit the three
 * reports of section 8 are read in — a payout run, a month's revenue, the
 * contracts expiring inside a horizon.
 */
export function monthOptions(now: Date, count = 6): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  for (let back = 0; back < count; back += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    options.push({ value, label: value });
  }
  return options;
}

/** Inclusive `from`/`to` for a `YYYY-MM`, in the shape the revenue report takes. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, index] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, index - 1, 1));
  const last = new Date(Date.UTC(year, index, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export const EXPIRY_HORIZONS = [30, 60, 90] as const;

/** `today + days`, as a date-only string — the expiry report's one parameter. */
export function horizonDate(now: Date, days: number): string {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days),
  );
  return date.toISOString().slice(0, 10);
}
