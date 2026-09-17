import "server-only";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/rbac/types";
import { orderByFromSort, pageSlice, type Paginated } from "@/lib/validation/list-query";
import { toUtcDate } from "@/lib/validation/common";
import type { ListAuditLogsQuery } from "@/lib/validation/audit-logs";

export type AuditLogRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: { id: string; name: string } | null;
  diff: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
};

type RawRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: { id: string; name: string } | null;
  diff: unknown;
  ipAddress: string | null;
  createdAt: Date;
};

const ROW_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  action: true,
  diff: true,
  ipAddress: true,
  createdAt: true,
  actor: { select: { id: true, name: true } },
} as const;

/**
 * The audit log has no scope of its own: "View audit logs" is Super Admin only in
 * the RBAC table, and the route's `withAuth("view", "auditLog")` denies everyone
 * else outright. So there is no owner filter here — the permission is the filter,
 * and `actor` is taken only to keep the signature uniform with the other services.
 *
 * Read-only by design: this module exports no writer. `audit_logs` is append-only
 * (section 8, "immutable"), and the only append path is `writeAudit(tx, …)`.
 */
export async function listAuditLogs(
  _actor: Actor,
  query: ListAuditLogsQuery,
): Promise<Paginated<AuditLogRow>> {
  const where: Record<string, unknown> = {};
  if (query.entityType) where.entityType = query.entityType;
  if (query.entityId) where.entityId = query.entityId;
  if (query.actorId) where.actorId = query.actorId;
  if (query.action) where.action = query.action;

  if (query.dateFrom || query.dateTo) {
    where.createdAt = {
      ...(query.dateFrom ? { gte: toUtcDate(query.dateFrom) } : {}),
      // `dateTo` is inclusive for the reader, so the bound is the next midnight.
      ...(query.dateTo ? { lt: nextDay(query.dateTo) } : {}),
    };
  }

  const { skip, take } = pageSlice(query.page, query.pageSize);

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      select: ROW_SELECT,
      orderBy: orderByFromSort(query.sort),
      skip,
      take,
    }),
  ]);

  return {
    data: rows.map((row: RawRow) => ({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      actor: row.actor,
      diff: (row.diff ?? null) as Record<string, unknown> | null,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

function nextDay(dateOnly: string): Date {
  const start = toUtcDate(dateOnly);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}
