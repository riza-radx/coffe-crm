import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { conflict, notFound } from "@/lib/api/errors";
import { toDecimalString, type DecimalString } from "@/lib/api/decimal";
import { sumFixed } from "@/lib/money/fixed-point";
import { permissionFor } from "@/lib/rbac";
import type { Actor } from "@/lib/rbac/types";
import { orderByFromSort, pageSlice, type Paginated } from "@/lib/validation/list-query";
import { toDateOnly } from "@/lib/validation/common";
import {
  checkCommissionTransition,
  type CommissionStatus,
} from "@/lib/commissions/state-machine";
import {
  BATCH_APPROVE_LIMIT,
  CSV_EXPORT_LIMIT,
  periodRange,
  type BatchApproveInput,
  type ExportCommissionsQuery,
  type ListCommissionsQuery,
} from "@/lib/validation/commissions";
import { writeAudit, writeAuditMany, type AuditAction } from "@/lib/audit/log";
import { templates, writeNotifications, type NotificationDraft } from "@/lib/notifications/notify";
import { enqueueNotificationEmails } from "@/lib/jobs/queue";

export type CommissionRow = {
  id: string;
  status: string;
  baseAmount: DecimalString;
  commissionPercentageSnapshot: DecimalString;
  commissionAmount: DecimalString;
  createdAt: string;
  paidAt: string | null;
  salesUser: { id: string; name: string };
  contract: { id: string };
  bill: {
    id: string;
    billNumber: string;
    billDate: string;
    status: string;
    client: { id: string; name: string };
  };
};

export type CommissionTotals = Record<string, { count: number; amount: DecimalString }>;

export type CommissionMutationContext = { ip?: string | null };

/**
 * A commission row is personal compensation, so a rep sees their own and nobody
 * else's — see the note on `viewAll:commission` in the RBAC matrix. The filter
 * is injected at the query level, so a `salesUserId` parameter cannot widen it.
 *
 * Exported as `commissionScopeWhere` so the Phase 4 commission summary is scoped
 * by this code rather than by a second copy of the same rule that could drift.
 */
export function commissionScopeWhere(actor: Actor): Record<string, unknown> {
  return scopeWhere(actor);
}

function scopeWhere(actor: Actor): Record<string, unknown> {
  const { scope } = permissionFor(actor, "viewAll", "commission");
  if (scope === "all") return {};
  if (scope === "own") return { salesUserId: actor.id };
  return { id: "__denied__" };
}

const ROW_SELECT = {
  id: true,
  status: true,
  baseAmount: true,
  commissionPercentageSnapshot: true,
  commissionAmount: true,
  createdAt: true,
  paidAt: true,
  salesUser: { select: { id: true, name: true } },
  contract: { select: { id: true } },
  bill: {
    select: {
      id: true,
      billNumber: true,
      billDate: true,
      status: true,
      client: { select: { id: true, name: true } },
    },
  },
} as const;

type Decimalish = { toFixed(dp: number): string };

type RawRow = {
  id: string;
  status: string;
  baseAmount: Decimalish;
  commissionPercentageSnapshot: Decimalish;
  commissionAmount: Decimalish;
  createdAt: Date;
  paidAt: Date | null;
  salesUser: { id: string; name: string };
  contract: { id: string };
  bill: {
    id: string;
    billNumber: string;
    billDate: Date;
    status: string;
    client: { id: string; name: string };
  };
};

function toRow(row: RawRow): CommissionRow {
  return {
    id: row.id,
    status: row.status,
    baseAmount: toDecimalString(row.baseAmount),
    commissionPercentageSnapshot: toDecimalString(row.commissionPercentageSnapshot),
    commissionAmount: toDecimalString(row.commissionAmount),
    createdAt: toDateOnly(row.createdAt),
    paidAt: row.paidAt ? toDateOnly(row.paidAt) : null,
    salesUser: row.salesUser,
    contract: row.contract,
    bill: {
      id: row.bill.id,
      billNumber: row.bill.billNumber,
      billDate: toDateOnly(row.bill.billDate),
      status: row.bill.status,
      client: row.bill.client,
    },
  };
}

/** The filters of GET /api/commissions — shared with batch approval, on purpose. */
function filtersFrom(query: {
  salesUserId?: string;
  status?: string;
  period?: string;
}): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  if (query.salesUserId) filters.salesUserId = query.salesUserId;
  if (query.status) filters.status = query.status;
  if (query.period) filters.bill = { billDate: periodRange(query.period) };
  return filters;
}

export async function listCommissions(
  actor: Actor,
  query: ListCommissionsQuery,
): Promise<Paginated<CommissionRow> & { totals: CommissionTotals }> {
  const where = { AND: [scopeWhere(actor), filtersFrom(query)] };
  const { skip, take } = pageSlice(query.page, query.pageSize);

  const [total, rows, grouped] = await Promise.all([
    prisma.commission.count({ where }),
    prisma.commission.findMany({
      where,
      select: ROW_SELECT,
      orderBy: orderByFromSort(query.sort),
      skip,
      take,
    }),
    prisma.commission.groupBy({
      by: ["status"],
      where,
      _sum: { commissionAmount: true },
      _count: { _all: true },
    }),
  ]);

  const totals: CommissionTotals = {};
  for (const group of grouped as Array<{
    status: string;
    _sum: { commissionAmount: Decimalish | null };
    _count: { _all: number };
  }>) {
    totals[group.status] = {
      count: group._count._all,
      amount: toDecimalString(group._sum.commissionAmount ?? "0"),
    };
  }

  return { data: rows.map(toRow), page: query.page, pageSize: query.pageSize, total, totals };
}

/**
 * The statement's columns, in the order `toReportRow` builds them. Widths are
 * relative and only the PDF uses them; the CSV takes the headers alone.
 */
export const COMMISSION_REPORT_COLUMNS = [
  { header: "Data e faturës", width: 11 },
  { header: "Nr. faturës", width: 11 },
  { header: "Klienti", width: 20 },
  { header: "Përfaqësuesi", width: 17 },
  { header: "Baza", width: 11, align: "right" as const },
  { header: "Përqindja", width: 8, align: "right" as const },
  { header: "Komisioni", width: 11, align: "right" as const },
  { header: "Statusi", width: 10 },
  { header: "Paguar më", width: 11 },
];

/** Kept for readers of Phase 5, when the statement was CSV only. */
export const COMMISSION_CSV_HEADERS = COMMISSION_REPORT_COLUMNS.map((column) => column.header);

/**
 * The statement rows: the same scope and filters as the list, without the page
 * window. The cap is enforced by `take`, and a full page means the caller is told
 * to narrow rather than being handed a silently truncated statement.
 */
export async function exportCommissions(
  actor: Actor,
  query: ExportCommissionsQuery,
): Promise<{ rows: string[][]; truncated: boolean; total: DecimalString }> {
  const where = { AND: [scopeWhere(actor), filtersFrom(query)] };
  const rows = await prisma.commission.findMany({
    where,
    select: ROW_SELECT,
    orderBy: orderByFromSort(query.sort),
    take: CSV_EXPORT_LIMIT + 1,
  });

  const truncated = rows.length > CSV_EXPORT_LIMIT;
  const kept = rows.slice(0, CSV_EXPORT_LIMIT).map(toRow);

  return {
    truncated,
    rows: kept.map(toReportRow),
    // The total of what the file actually contains, not of the whole filter —
    // a footer that disagrees with the rows above it is worse than no footer.
    total: sumFixed(kept.map((row) => row.commissionAmount)),
  };
}

function toReportRow(row: CommissionRow): string[] {
  return [
    row.bill.billDate,
    row.bill.billNumber,
    row.bill.client.name,
    row.salesUser.name,
    row.baseAmount,
    row.commissionPercentageSnapshot,
    row.commissionAmount,
    row.status,
    row.paidAt ?? "",
  ];
}

export async function getCommission(actor: Actor, id: string): Promise<CommissionRow> {
  const row = await prisma.commission.findFirst({
    where: { AND: [scopeWhere(actor), { id }] },
    select: ROW_SELECT,
  });
  if (!row) throw notFound("COMMISSION_NOT_FOUND");
  return toRow(row);
}

const AUDIT_ACTION: Record<CommissionStatus, AuditAction> = {
  APPROVED: "APPROVE",
  PAID: "PAY",
  PENDING: "STATUS_CHANGE",
};

async function transitionCommission(
  actor: Actor,
  id: string,
  to: CommissionStatus,
  ctx: CommissionMutationContext,
): Promise<CommissionRow> {
  const { row, emails } = await prisma.$transaction(async (tx) => {
    const existing = await tx.commission.findFirst({
      where: { AND: [scopeWhere(actor), { id }] },
      select: {
        id: true,
        status: true,
        salesUserId: true,
        commissionAmount: true,
        bill: { select: { status: true } },
      },
    });
    if (!existing) throw notFound("COMMISSION_NOT_FOUND");

    const verdict = checkCommissionTransition(existing.status as CommissionStatus, to);
    if (!verdict.ok) throw conflict(`TRANSITION_${verdict.code}`, { from: existing.status, to });

    // The invariant behind the money: a commission only exists for a verified bill.
    if (existing.bill.status !== "VERIFIED") {
      throw conflict("BILL_NOT_VERIFIED", { status: existing.bill.status });
    }

    const paid = to === "PAID";
    const data = paid
      ? { status: to, paidAt: new Date(), paidById: actor.id }
      : { status: to };

    const moved = await tx.commission.updateMany({ where: { id, status: existing.status }, data });
    if (moved.count !== 1) throw conflict("COMMISSION_CONCURRENT_MODIFICATION");

    await writeAudit(tx, {
      actorId: actor.id,
      entityType: "COMMISSION",
      entityId: id,
      action: AUDIT_ACTION[to],
      // The schema has no approved_at/approved_by columns — who approved, and
      // when, lives here.
      diff: {
        before: { status: existing.status },
        after: paid ? { status: to, paidById: actor.id } : { status: to },
      },
      ip: ctx.ip,
    });

    // Section 8: the rep is told when their commission is approved and when it is
    // paid — the two moments money changes meaning for them.
    const amount = toDecimalString(existing.commissionAmount);
    const draft: NotificationDraft | null = paid
      ? templates.commissionPaid({ userId: existing.salesUserId, commissionId: id, amount })
      : to === "APPROVED"
        ? templates.commissionApproved({ userId: existing.salesUserId, commissionId: id, amount })
        : null;
    const emails = draft ? await writeNotifications(tx, [draft]) : [];

    return { row: await readBack(tx, id), emails };
  });

  await enqueueNotificationEmails(emails);
  return row;
}

async function readBack(tx: Tx, id: string): Promise<CommissionRow> {
  const row = await tx.commission.findUnique({ where: { id }, select: ROW_SELECT });
  if (!row) throw notFound("COMMISSION_NOT_FOUND");
  return toRow(row);
}

export const approveCommission = (actor: Actor, id: string, ctx: CommissionMutationContext = {}) =>
  transitionCommission(actor, id, "APPROVED", ctx);

export const payCommission = (actor: Actor, id: string, ctx: CommissionMutationContext = {}) =>
  transitionCommission(actor, id, "PAID", ctx);

export type BatchApproveResult = {
  approved: number;
  ids: string[];
  skipped: Array<{ id: string; reason: string }>;
};

/**
 * "Batch approval lets Super Admin approve all PENDING commissions for a period
 * in one action" (section 6). One transaction for the whole batch, so a payout
 * run is never half-approved, and one audit row per commission, so each row's
 * own history stays complete.
 *
 * Ids that are gone, out of scope or no longer PENDING are reported as skipped
 * rather than failing the batch: two admins clicking the same run should not
 * cancel each other out.
 */
export async function batchApproveCommissions(
  actor: Actor,
  input: BatchApproveInput,
  ctx: CommissionMutationContext = {},
): Promise<BatchApproveResult> {
  const { result, emails } = await prisma.$transaction(async (tx) => {
    const selector = input.ids?.length
      ? { id: { in: input.ids } }
      : filtersFrom({ salesUserId: input.salesUserId, period: input.period });

    const candidates = (await tx.commission.findMany({
      where: { AND: [scopeWhere(actor), selector, { status: "PENDING" }] },
      select: { id: true, salesUserId: true, commissionAmount: true },
    })) as Array<{ id: string; salesUserId: string; commissionAmount: Decimalish }>;

    if (!input.ids?.length && candidates.length > BATCH_APPROVE_LIMIT) {
      throw conflict("BATCH_TOO_LARGE", { matched: candidates.length, limit: BATCH_APPROVE_LIMIT });
    }

    const eligible = candidates.map((row) => row.id);
    const skipped = (input.ids ?? [])
      .filter((id) => !eligible.includes(id))
      .map((id) => ({ id, reason: "NOT_PENDING_OR_OUT_OF_SCOPE" }));

    if (eligible.length === 0) return { result: { approved: 0, ids: [], skipped }, emails: [] };

    const moved = await tx.commission.updateMany({
      where: { id: { in: eligible }, status: "PENDING" },
      data: { status: "APPROVED" },
    });
    if (moved.count !== eligible.length) throw conflict("COMMISSION_CONCURRENT_MODIFICATION");

    await writeAuditMany(
      tx,
      eligible.map((id) => ({
        actorId: actor.id,
        entityType: "COMMISSION" as const,
        entityId: id,
        action: "APPROVE" as const,
        diff: { before: { status: "PENDING" }, after: { status: "APPROVED" }, batch: true },
        ip: ctx.ip,
      })),
    );

    // A batch run is still one notification per rep per commission: the bell is
    // personal, and "12 commissions approved" hides which ones.
    const emails = await writeNotifications(
      tx,
      candidates.map((row) =>
        templates.commissionApproved({
          userId: row.salesUserId,
          commissionId: row.id,
          amount: toDecimalString(row.commissionAmount),
        }),
      ),
    );

    return { result: { approved: eligible.length, ids: eligible, skipped }, emails };
  });

  await enqueueNotificationEmails(emails);
  return result;
}
