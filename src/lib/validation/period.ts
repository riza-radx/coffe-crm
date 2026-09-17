import { z } from "zod";

/**
 * A reporting period is a month, a quarter or a year, resolved in UTC against the
 * *bill's* date — the rule Phase 3 established for payouts and that analytics now
 * shares, so "what the leaderboard shows for September" and "what batch approval
 * would approve for September" cover exactly the same bills.
 *
 * Phase 3's own schema stays month-only (see validation/commissions.ts): batch
 * approval shares it, and approving a whole year on a typo is not a feature.
 */
export type PeriodKind = "month" | "quarter" | "year";

/** YYYY-MM — the Phase 3 period, unchanged. */
export const MonthPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Periudhë e pavlefshme (YYYY-MM)" });

/** YYYY | YYYY-MM | YYYY-Qn, with a lowercase `q` normalized. */
export const AnalyticsPeriodSchema = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2]|[Qq][1-4]))?$/, {
    error: "Periudhë e pavlefshme (YYYY, YYYY-MM ose YYYY-Qn)",
  })
  .transform((value) => value.toUpperCase());

export type ParsedPeriod = {
  kind: PeriodKind;
  year: number;
  /** 0-based, like Date.UTC's month argument. */
  startMonth: number;
  months: number;
};

export function parsePeriod(period: string): ParsedPeriod {
  const normalized = period.toUpperCase();
  const [yearPart, part] = normalized.split("-");
  const year = Number(yearPart);

  if (!part) return { kind: "year", year, startMonth: 0, months: 12 };
  if (part.startsWith("Q")) {
    const quarter = Number(part.slice(1));
    return { kind: "quarter", year, startMonth: (quarter - 1) * 3, months: 3 };
  }
  return { kind: "month", year, startMonth: Number(part) - 1, months: 1 };
}

/**
 * Half-open [gte, lt) in UTC. `Date.UTC` rolls a month index of 12 into the next
 * January by itself, so December and Q4 need no special case.
 */
export function periodRange(period: string): { gte: Date; lt: Date } {
  const { year, startMonth, months } = parsePeriod(period);
  return {
    gte: new Date(Date.UTC(year, startMonth, 1)),
    lt: new Date(Date.UTC(year, startMonth + months, 1)),
  };
}
