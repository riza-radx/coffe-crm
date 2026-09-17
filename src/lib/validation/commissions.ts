import { z } from "zod";
import { CUID } from "./common";
import { paginationSchema, sortParamSchema } from "./list-query";
import { MonthPeriodSchema, periodRange } from "./period";

export const CommissionStatusSchema = z.enum(["PENDING", "APPROVED", "PAID"]);

/**
 * A payout period is a calendar month, resolved in UTC against the *bill's*
 * date, not the commission's `created_at`.
 *
 * The commissions table has no period column, so the period has to be derived.
 * `created_at` is the moment of verification: a bill verified late would slip
 * into a later payout run, and a dispute followed by a re-verification would
 * move money between months. `bill_date` is the business fact and is stable
 * across re-verification. The list and batch approval share this resolver, so
 * "approve what I am looking at" approves exactly what is on screen.
 *
 * Phase 4 moved the resolver to validation/period.ts so analytics can widen it to
 * quarters and years. This schema deliberately did not widen with it: it is shared
 * with `BatchApproveSchema`, where a period is the blast radius of one click.
 */
export const PeriodSchema = MonthPeriodSchema;

export { periodRange };

export const COMMISSION_SORTABLE = ["createdAt", "commissionAmount", "status"] as const;

export const ListCommissionsQuerySchema = paginationSchema.extend({
  salesUserId: CUID.optional(),
  status: CommissionStatusSchema.optional(),
  period: PeriodSchema.optional(),
  sort: sortParamSchema(COMMISSION_SORTABLE, "createdAt:desc"),
});

/**
 * "CSV export for commission statements" (MVP plan, step 16) is a representation
 * of the list, not a second endpoint: the same filters, the same scope, the same
 * resolver for the period. `format` drops the page window — a statement with
 * page 2 missing is not a statement — and is bounded by its own cap instead.
 *
 * Phase 6 adds `pdf` beside `csv`; both read the same rows through the same
 * service, so the two files can never disagree.
 */
export const ExportCommissionsQuerySchema = ListCommissionsQuerySchema.extend({
  format: z.enum(["csv", "pdf"]),
});

/** Past this, the caller narrows by period or rep rather than exporting the archive. */
export const CSV_EXPORT_LIMIT = 5000;

/** Ids the caller ticked, or the same filters the list uses — never "everything". */
export const BatchApproveSchema = z
  .object({
    ids: z.array(CUID).min(1).max(200).optional(),
    salesUserId: CUID.optional(),
    period: PeriodSchema.optional(),
  })
  .refine((value) => Boolean(value.ids?.length || value.salesUserId || value.period), {
    error: "Zgjidh komisione ose një filtër (përfaqësues / periudhë)",
  });

/** Filter-mode safety valve: past this, the caller narrows instead of approving blind. */
export const BATCH_APPROVE_LIMIT = 500;

export type ListCommissionsQuery = z.infer<typeof ListCommissionsQuerySchema>;
export type ExportCommissionsQuery = z.infer<typeof ExportCommissionsQuerySchema>;
export type BatchApproveInput = z.output<typeof BatchApproveSchema>;
