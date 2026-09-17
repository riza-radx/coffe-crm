import { z } from "zod";
import { CUID, DateOnlySchema } from "./common";
import { paginationSchema, sortParamSchema } from "./list-query";

/** The five entity types `writeAudit` can produce — section 2 of the plan. */
export const AuditEntityTypeSchema = z.enum([
  "CONTRACT",
  "BILL",
  "CLIENT",
  "USER",
  "COMMISSION",
]);

export const AuditActionSchema = z.enum([
  "CREATE",
  "UPDATE",
  "DELETE",
  "STATUS_CHANGE",
  "VERIFY",
  "DISPUTE",
  "VOID",
  "APPROVE",
  "PAY",
]);

/**
 * Only `createdAt` is sortable. The table is an append-only log read newest
 * first; sorting it by actor or entity would be a grouping question, and the
 * filters answer that better than an ORDER BY.
 */
export const AUDIT_SORTABLE = ["createdAt"] as const;

export const ListAuditLogsQuerySchema = paginationSchema
  .extend({
    entityType: AuditEntityTypeSchema.optional(),
    entityId: CUID.optional(),
    actorId: CUID.optional(),
    action: AuditActionSchema.optional(),
    // Section 8: "searchable by entity, actor, date range".
    dateFrom: DateOnlySchema.optional(),
    dateTo: DateOnlySchema.optional(),
    sort: sortParamSchema(AUDIT_SORTABLE, "createdAt:desc"),
  })
  .refine((v) => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, {
    error: "Data e fillimit është pas datës së mbarimit",
  });

export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuerySchema>;
