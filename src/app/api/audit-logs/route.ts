import { NextResponse } from "next/server";
import { withAuth, validationError } from "@/lib/auth/guards";
import { searchParamsToObject } from "@/lib/validation/list-query";
import { ListAuditLogsQuerySchema } from "@/lib/validation/audit-logs";
import { listAuditLogs } from "@/lib/queries/audit-logs";

export const runtime = "nodejs";

/**
 * Super Admin only — "View audit logs" is Yes / No / No in the RBAC table, so the
 * guard is the whole access decision and the service needs no owner filter.
 * There is no POST, PATCH or DELETE here: the log is append-only, written from
 * inside the transaction of the change it describes.
 */
export const GET = withAuth("view", "auditLog", async (request, { actor }) => {
  const parsed = ListAuditLogsQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(await listAuditLogs(actor, parsed.data));
});
