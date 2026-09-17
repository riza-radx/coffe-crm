/**
 * The revenue report returns only the months that had bills. A trend line with
 * gaps where nothing was sold reads as missing data rather than as a quiet month,
 * so the series is filled to a continuous run of months before it is plotted.
 */
export function monthKeys(end: Date, count: number): string[] {
  const keys: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - back, 1));
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

export function fillMonths(
  keys: string[],
  rows: Array<{ key: string; revenue: string }>,
): Array<{ key: string; revenue: string }> {
  const byKey = new Map(rows.map((row) => [row.key, row.revenue]));
  return keys.map((key) => ({ key, revenue: byKey.get(key) ?? "0.00" }));
}

/** The window the trend asks for: the first day of the oldest month, to today. */
export function trendRange(end: Date, months: number): { from: string; to: string } {
  const first = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
  return { from: first.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
