import { z } from "zod";
import { BillAmountSchema } from "./decimal";
import { CUID, DateOnlySchema, OptionalText } from "./common";
import { paginationSchema, sortParamSchema } from "./list-query";

export const BillStatusSchema = z.enum(["PENDING", "VERIFIED", "DISPUTED", "VOID"]);

export const BILL_SORTABLE = ["billDate", "amount", "status", "createdAt"] as const;

export const ListBillsQuerySchema = paginationSchema.extend({
  contractId: CUID.optional(),
  clientId: CUID.optional(),
  status: BillStatusSchema.optional(),
  dateFrom: DateOnlySchema.optional(),
  dateTo: DateOnlySchema.optional(),
  sort: sortParamSchema(BILL_SORTABLE, "billDate:desc"),
});

export const CreateBillSchema = z.object({
  contractId: CUID,
  billNumber: z.string().trim().min(1, { error: "Numri i faturës është i detyrueshëm" }).max(60),
  amount: BillAmountSchema,
  currency: z.string().trim().length(3).default("ALL"),
  billDate: DateOnlySchema,
  attachmentUrl: OptionalText(500),
});

/**
 * Corrections to a bill that has not been verified yet. `contractId` and
 * `clientId` are deliberately absent: moving a bill to another contract would
 * move commission attribution with it, which is a reassignment, not an edit.
 */
export const UpdateBillSchema = z.object({
  billNumber: z.string().trim().min(1).max(60).optional(),
  amount: BillAmountSchema.optional(),
  currency: z.string().trim().length(3).optional(),
  billDate: DateOnlySchema.optional(),
  attachmentUrl: OptionalText(500),
});

/** Dispute and void accept a reason; there is no column for it, so it lives in the audit diff. */
export const BillActionSchema = z.object({ reason: OptionalText(500) });

export type ListBillsQuery = z.infer<typeof ListBillsQuerySchema>;
export type UpdateBillInput = z.output<typeof UpdateBillSchema>;
export type BillActionInput = z.output<typeof BillActionSchema>;
export type CreateBillForm = z.input<typeof CreateBillSchema>;
export type CreateBillInput = z.output<typeof CreateBillSchema>;
