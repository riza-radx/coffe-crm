import { z } from "zod";
import { DateOnlySchema } from "./common";
import { AnalyticsPeriodSchema } from "./period";

export const REVENUE_GROUP_BY = ["client", "salesRep", "month"] as const;
export const RevenueGroupBySchema = z.enum(REVENUE_GROUP_BY);
export type RevenueGroupBy = (typeof REVENUE_GROUP_BY)[number];

/** Top-N per request. Section 9: no list endpoint returns an unbounded set. */
export const ANALYTICS_GROUP_LIMIT = 100;

/** Two years and a day, so a month-grouped series is at most 24 points. */
export const ANALYTICS_MAX_RANGE_DAYS = 731;

/** A safety valve on the leaderboard, not a product limit — Rei has a dozen reps. */
export const LEADERBOARD_MAX_REPS = 200;

export const LeaderboardQuerySchema = z.object({ period: AnalyticsPeriodSchema });

const DAY_MS = 24 * 60 * 60 * 1000;

export function rangeDays(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS + 1;
}

/**
 * `from` and `to` are required and inclusive. No implicit "last 12 months"
 * default: a default that reads the clock makes two callers a millisecond apart
 * disagree, and makes every test time-dependent. The dashboard computes its own
 * window and sends it.
 */
export const RevenueQuerySchema = z
  .object({
    groupBy: RevenueGroupBySchema,
    from: DateOnlySchema,
    to: DateOnlySchema,
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ANALYTICS_GROUP_LIMIT)
      .default(ANALYTICS_GROUP_LIMIT),
  })
  // YYYY-MM-DD compares correctly as a string, so no Date round-trip is needed.
  .refine((v) => v.from <= v.to, { error: "Data e fillimit është pas datës së mbarimit" })
  .refine((v) => rangeDays(v.from, v.to) <= ANALYTICS_MAX_RANGE_DAYS, {
    error: `Intervali i kalon ${ANALYTICS_MAX_RANGE_DAYS} ditë`,
  });

/** Phase 6: the revenue report of section 8, as a file rather than as JSON. */
export const ExportRevenueQuerySchema = RevenueQuerySchema.safeExtend({
  format: z.enum(["csv", "pdf"]),
});

export type ExportRevenueQuery = z.infer<typeof ExportRevenueQuerySchema>;
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;
export type RevenueQuery = z.infer<typeof RevenueQuerySchema>;
