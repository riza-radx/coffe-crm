/**
 * Chart formatting. Amounts arrive as fixed-scale strings and only ever become a
 * number here, for geometry and for axis ticks — never for arithmetic that ends
 * up in a payout. A pixel is allowed to be approximate; a commission is not.
 */

export function toPlotNumber(amount: string): number {
  const value = Number(amount);
  return Number.isFinite(value) ? value : 0;
}

/** 1 284 / 12.9K / 4.2M — axis ticks and tips, where space is the constraint. */
export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(value / 1_000)}K`;
  return trim(value);
}

function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Full precision, for tooltips and the table view. */
export function money(amount: string, currency = "ALL"): string {
  return `${new Intl.NumberFormat("sq-AL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toPlotNumber(amount))} ${currency}`;
}

/** "2026-09" → "Shta 2026". Month keys are UTC, like everything else here. */
const MONTHS = [
  "Jan",
  "Shk",
  "Mar",
  "Pri",
  "Maj",
  "Qer",
  "Kor",
  "Gsh",
  "Sht",
  "Tet",
  "Nën",
  "Dhj",
];

export function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const index = Number(month) - 1;
  return MONTHS[index] ? `${MONTHS[index]} ${year}` : key;
}

/**
 * Clean axis ticks: 0, then round steps up to the top of the data. Returns the
 * tick values and the scale maximum they define, so the plot and the axis can
 * never disagree about where the top is.
 */
export function niceScale(max: number, ticks = 4): { max: number; values: number[] } {
  if (max <= 0) return { max: 1, values: [0, 1] };
  const rawStep = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const top = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) values.push(value);
  return { max: top, values };
}
