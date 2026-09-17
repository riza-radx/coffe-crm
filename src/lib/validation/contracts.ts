import { z } from "zod";
import { CommissionPercentageSchema } from "./decimal";
import { CUID, DateOnlySchema, OptionalText } from "./common";
import { paginationSchema, sortParamSchema } from "./list-query";

export const ContractStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "EXPIRED",
  "TERMINATED",
  "RENEWED",
]);

export const CONTRACT_SORTABLE = ["startDate", "endDate", "status", "createdAt"] as const;

export const ListContractsQuerySchema = paginationSchema.extend({
  clientId: CUID.optional(),
  status: ContractStatusSchema.optional(),
  salesOwner: CUID.optional(),
  /**
   * Phase 6: section 8 asks for a "contract expiry list" report. That is this
   * list with one more predicate, not a new endpoint — so the report and the
   * screen a rep already uses read the same rows through the same service.
   */
  expiringBefore: DateOnlySchema.optional(),
  sort: sortParamSchema(CONTRACT_SORTABLE, "createdAt:desc"),
});

/** The expiry report: the same filters, no page window, capped by its own limit. */
export const ExportContractsQuerySchema = ListContractsQuerySchema.extend({
  format: z.enum(["csv", "pdf"]),
});

export const CONTRACT_EXPORT_LIMIT = 5000;

export const CreateContractSchema = z
  .object({
    clientId: CUID,
    /** Super Admin only; a rep is always the owner of the contracts they create. */
    salesOwnerId: CUID.optional(),
    commissionPercentage: CommissionPercentageSchema,
    startDate: DateOnlySchema,
    endDate: DateOnlySchema.optional(),
    paymentTerms: OptionalText(300),
    notes: OptionalText(1000),
    signedDocumentUrl: OptionalText(500),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    error: "Data e mbarimit nuk mund të jetë para datës së fillimit",
    path: ["endDate"],
  });

/**
 * PATCH accepts a status so the DRAFT→ACTIVE transition has a home; the state
 * machine decides whether the move is legal. commissionPercentage is accepted only
 * for a Super Admin (the plan's audited "amend" action) — the route enforces that.
 */
export const UpdateContractSchema = z.object({
  commissionPercentage: CommissionPercentageSchema.optional(),
  startDate: DateOnlySchema.optional(),
  endDate: DateOnlySchema.nullable().optional(),
  status: ContractStatusSchema.optional(),
  paymentTerms: OptionalText(300),
  notes: OptionalText(1000),
  signedDocumentUrl: OptionalText(500),
  salesOwnerId: CUID.optional(),
});

/**
 * Renewal (section 4: POST /api/contracts/:id/renew).
 *
 * The successor's terms are the old contract's unless the caller overrides them,
 * and `commissionPercentage` is an override like any other — so it stays behind
 * the same Super Admin check as an amendment, enforced in the service.
 */
export const RenewContractSchema = z
  .object({
    startDate: DateOnlySchema,
    endDate: DateOnlySchema.optional(),
    commissionPercentage: CommissionPercentageSchema.optional(),
    paymentTerms: OptionalText(300),
    notes: OptionalText(1000),
    signedDocumentUrl: OptionalText(500),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    error: "Data e mbarimit nuk mund të jetë para datës së fillimit",
    path: ["endDate"],
  });

/** Section 6: "TERMINATED — manual action, requires a reason field". */
export const TerminateContractSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, { error: "Arsyeja duhet të ketë të paktën 5 karaktere" })
    .max(500),
});

export type ListContractsQuery = z.infer<typeof ListContractsQuerySchema>;
export type ExportContractsQuery = z.infer<typeof ExportContractsQuerySchema>;
export type RenewContractForm = z.input<typeof RenewContractSchema>;
export type RenewContractInput = z.output<typeof RenewContractSchema>;
export type TerminateContractInput = z.output<typeof TerminateContractSchema>;
export type CreateContractForm = z.input<typeof CreateContractSchema>;
export type CreateContractInput = z.output<typeof CreateContractSchema>;
export type UpdateContractInput = z.output<typeof UpdateContractSchema>;
