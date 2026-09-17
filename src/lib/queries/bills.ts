import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { conflict, notFound } from "@/lib/api/errors";
import { toDecimalString, type DecimalString } from "@/lib/api/decimal";
import { permissionFor } from "@/lib/rbac";
import type { Action, Actor, Resource } from "@/lib/rbac/types";
import { orderByFromSort, pageSlice, type Paginated } from "@/lib/validation/list-query";
import { toDateOnly, toUtcDate } from "@/lib/validation/common";
import { acceptsBills, type ContractStatus } from "@/lib/contracts/state-machine";
import {
  checkBillTransition,
  createsCommission,
  isBillEditable,
  type BillStatus,
} from "@/lib/bills/state-machine";
import { isCommissionDeletable, type CommissionStatus } from "@/lib/commissions/state-machine";
import { calculateCommission } from "@/lib/commissions/calculate";
import { changedFields, writeAudit, type AuditAction } from "@/lib/audit/log";
import { templates, writeNotifications } from "@/lib/notifications/notify";
import { enqueueNotificationEmails } from "@/lib/jobs/queue";
import type { CreateBillInput, ListBillsQuery, UpdateBillInput } from "@/lib/validation/bills";

export type BillCommissionSummary = {
  id: string;
  status: string;
  commissionAmount: DecimalString;
};

export type BillRow = {
  id: string;
  billNumber: string;
  amount: DecimalString;
  currency: string;
  billDate: string;
  status: string;
  client: { id: string; name: string };
  contract: { id: string; status: string; salesOwner?: { id: string; name: string } };
  enteredBy: { id: string; name: string };
  /** Null until the bill is verified; the list needs it to know what is locked. */
  commission: BillCommissionSummary | null;
};

/** Mutations carry the request context the audit entry needs. */
export type BillMutationContext = { ip?: string | null; reason?: string };

/**
 * A bill inherits its contract's visibility: there is no separate bill row in the
 * RBAC table, and every bill hangs off exactly one contract. Which permission
 * decides the scope depends on what is being done — "View all contracts" gives
 * internal Sales every contract, while "Verify/dispute bill" gives them only
 * their own, so reading and verifying must not share one filter.
 */
function scopeWhereFor(actor: Actor, action: Action, resource: Resource): Record<string, unknown> {
  const { scope } = permissionFor(actor, action, resource);
  if (scope === "all") return {};
  if (scope === "own") return { contract: { salesOwnerId: actor.id } };
  return { id: "__denied__" };
}

const scopeWhere = (actor: Actor) => scopeWhereFor(actor, "viewAll", "contract");
const verifyScopeWhere = (actor: Actor) => scopeWhereFor(actor, "verify", "bill");
const editScopeWhere = (actor: Actor) => scopeWhereFor(actor, "create", "bill");

const ROW_SELECT = {
  id: true,
  billNumber: true,
  amount: true,
  currency: true,
  billDate: true,
  status: true,
  client: { select: { id: true, name: true } },
  contract: {
    select: { id: true, status: true, salesOwner: { select: { id: true, name: true } } },
  },
  enteredBy: { select: { id: true, name: true } },
  commission: { select: { id: true, status: true, commissionAmount: true } },
} as const;

type RawRow = {
  id: string;
  billNumber: string;
  amount: { toFixed(dp: number): string };
  currency: string;
  billDate: Date;
  status: string;
  client: { id: string; name: string };
  contract: { id: string; status: string; salesOwner?: { id: string; name: string } };
  enteredBy: { id: string; name: string };
  commission?: { id: string; status: string; commissionAmount: { toFixed(dp: number): string } } | null;
};

function toRow(row: RawRow): BillRow {
  return {
    id: row.id,
    billNumber: row.billNumber,
    amount: toDecimalString(row.amount),
    currency: row.currency,
    billDate: toDateOnly(row.billDate),
    status: row.status,
    client: row.client,
    contract: row.contract,
    enteredBy: row.enteredBy,
    commission: row.commission
      ? {
          id: row.commission.id,
          status: row.commission.status,
          commissionAmount: toDecimalString(row.commission.commissionAmount),
        }
      : null,
  };
}

export async function listBills(actor: Actor, query: ListBillsQuery): Promise<Paginated<BillRow>> {
  const filters: Record<string, unknown> = {};
  if (query.contractId) filters.contractId = query.contractId;
  if (query.clientId) filters.clientId = query.clientId;
  if (query.status) filters.status = query.status;
  if (query.dateFrom || query.dateTo) {
    filters.billDate = {
      ...(query.dateFrom ? { gte: toUtcDate(query.dateFrom) } : {}),
      ...(query.dateTo ? { lte: toUtcDate(query.dateTo) } : {}),
    };
  }

  const where = { AND: [scopeWhere(actor), filters] };
  const { skip, take } = pageSlice(query.page, query.pageSize);

  const [total, rows] = await Promise.all([
    prisma.bill.count({ where }),
    prisma.bill.findMany({
      where,
      select: ROW_SELECT,
      orderBy: orderByFromSort(query.sort),
      skip,
      take,
    }),
  ]);

  return { data: rows.map(toRow), page: query.page, pageSize: query.pageSize, total };
}

export async function getBill(actor: Actor, id: string): Promise<BillRow> {
  const bill = await prisma.bill.findFirst({
    where: { AND: [scopeWhere(actor), { id }] },
    select: ROW_SELECT,
  });
  if (!bill) throw notFound("BILL_NOT_FOUND");
  return toRow(bill);
}

export async function createBill(actor: Actor, input: CreateBillInput): Promise<BillRow> {
  const ownScopeOnly = permissionFor(actor, "create", "bill").scope === "own";

  const contract = await prisma.contract.findUnique({
    where: { id: input.contractId },
    select: { id: true, status: true, clientId: true, salesOwnerId: true },
  });
  if (!contract) throw notFound("CONTRACT_NOT_FOUND");

  // "Add bill — Sales: yes (own contracts), Outside Sales: yes (own contracts only)".
  // Reported as missing rather than forbidden so a rep cannot probe other reps' ids.
  if (ownScopeOnly && contract.salesOwnerId !== actor.id) throw notFound("CONTRACT_NOT_FOUND");

  // Section 6: DRAFT contracts cannot have bills; only an ACTIVE contract accepts them.
  if (!acceptsBills(contract.status as ContractStatus)) {
    throw conflict("CONTRACT_NOT_ACTIVE", { status: contract.status });
  }

  const created = await prisma.bill.create({
    data: {
      contractId: contract.id,
      // Denormalized from the contract, never taken from the request.
      clientId: contract.clientId,
      billNumber: input.billNumber,
      amount: input.amount,
      currency: input.currency,
      billDate: toUtcDate(input.billDate),
      enteredById: actor.id,
      // The commission is created when the bill is verified, not now.
      status: "PENDING",
    },
    select: ROW_SELECT,
  });
  return toRow(created);
}

/** Corrections before verification. A verified bill is corrected by disputing it first. */
export async function updateBill(
  actor: Actor,
  id: string,
  input: UpdateBillInput,
  ctx: BillMutationContext = {},
): Promise<BillRow> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.bill.findFirst({
      where: { AND: [editScopeWhere(actor), { id }] },
      select: { id: true, status: true, billNumber: true, amount: true, currency: true, billDate: true },
    });
    if (!existing) throw notFound("BILL_NOT_FOUND");
    if (!isBillEditable(existing.status as BillStatus)) {
      throw conflict("BILL_NOT_EDITABLE", { status: existing.status });
    }

    const data: Record<string, unknown> = {};
    if (input.billNumber !== undefined) data.billNumber = input.billNumber;
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.billDate !== undefined) data.billDate = toUtcDate(input.billDate);
    if (input.attachmentUrl !== undefined) data.attachmentUrl = input.attachmentUrl;

    const moved = await tx.bill.updateMany({ where: { id, status: existing.status }, data });
    if (moved.count !== 1) throw conflict("BILL_CONCURRENT_MODIFICATION");

    await writeAudit(tx, {
      actorId: actor.id,
      entityType: "BILL",
      entityId: id,
      action: "UPDATE",
      diff: changedFields(
        {
          billNumber: existing.billNumber,
          amount: toDecimalString(existing.amount),
          currency: existing.currency,
          billDate: toDateOnly(existing.billDate),
        },
        {
          billNumber: input.billNumber,
          amount: input.amount,
          currency: input.currency,
          billDate: input.billDate,
        },
      ),
      ip: ctx.ip,
    });

    return readBack(tx, id);
  });
}

const AUDIT_ACTION: Record<BillStatus, AuditAction> = {
  VERIFIED: "VERIFY",
  DISPUTED: "DISPUTE",
  VOID: "VOID",
  PENDING: "STATUS_CHANGE",
};

/**
 * One transaction per transition: the bill moves, the commission is snapshotted
 * or reversed with it, and both audit entries land inside the same transaction.
 * Concurrency is handled by a status-guarded updateMany plus the unique index on
 * commissions.bill_id — no row locks, no serializable isolation.
 */
async function transitionBill(
  actor: Actor,
  id: string,
  to: BillStatus,
  ctx: BillMutationContext,
): Promise<BillRow> {
  const { row, emails } = await prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { AND: [verifyScopeWhere(actor), { id }] },
      select: {
        id: true,
        status: true,
        amount: true,
        billNumber: true,
        contractId: true,
        contract: { select: { salesOwnerId: true, commissionPercentage: true } },
        commission: {
          select: {
            id: true,
            status: true,
            salesUserId: true,
            baseAmount: true,
            commissionPercentageSnapshot: true,
            commissionAmount: true,
          },
        },
      },
    });
    if (!bill) throw notFound("BILL_NOT_FOUND");

    const verdict = checkBillTransition(bill.status as BillStatus, to);
    if (!verdict.ok) throw conflict(`TRANSITION_${verdict.code}`, { from: bill.status, to });

    if (createsCommission(to) && bill.commission) throw conflict("COMMISSION_ALREADY_EXISTS");

    // An approved or paid commission is settled money: the bill behind it can no
    // longer be disputed or voided, so the whole transition is refused.
    if (bill.commission && !isCommissionDeletable(bill.commission.status as CommissionStatus)) {
      throw conflict("COMMISSION_LOCKED", { commissionStatus: bill.commission.status });
    }

    const moved = await tx.bill.updateMany({ where: { id, status: bill.status }, data: { status: to } });
    if (moved.count !== 1) throw conflict("BILL_CONCURRENT_MODIFICATION");

    await writeAudit(tx, {
      actorId: actor.id,
      entityType: "BILL",
      entityId: id,
      action: AUDIT_ACTION[to],
      diff: {
        before: { status: bill.status },
        after: { status: to },
        ...(ctx.reason ? { reason: ctx.reason } : {}),
      },
      ip: ctx.ip,
    });

    if (createsCommission(to)) {
      // Section 6: the percentage is copied here, at the moment of verification,
      // and never looked up live afterwards.
      const calculation = calculateCommission({
        amount: toDecimalString(bill.amount),
        percentage: toDecimalString(bill.contract.commissionPercentage),
      });
      const commission = await tx.commission.create({
        data: {
          billId: id,
          contractId: bill.contractId,
          // Attribution follows the contract owner, never the request.
          salesUserId: bill.contract.salesOwnerId,
          ...calculation,
          status: "PENDING",
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        entityType: "COMMISSION",
        entityId: commission.id,
        action: "CREATE",
        diff: {
          after: {
            billId: id,
            salesUserId: bill.contract.salesOwnerId,
            ...calculation,
            status: "PENDING",
          },
        },
        ip: ctx.ip,
      });
    } else if (bill.commission) {
      // Reversal is a delete (bill_id is unique, so a later re-verification takes a
      // fresh snapshot). The deleted values survive in the audit entry.
      const before = {
        billId: id,
        salesUserId: bill.commission.salesUserId,
        commissionPercentageSnapshot: toDecimalString(bill.commission.commissionPercentageSnapshot),
        baseAmount: toDecimalString(bill.commission.baseAmount),
        commissionAmount: toDecimalString(bill.commission.commissionAmount),
        status: bill.commission.status,
      };
      await tx.commission.delete({ where: { id: bill.commission.id } });
      await writeAudit(tx, {
        actorId: actor.id,
        entityType: "COMMISSION",
        entityId: bill.commission.id,
        action: "DELETE",
        diff: { before, ...(ctx.reason ? { reason: ctx.reason } : {}) },
        ip: ctx.ip,
      });
    }

    // Section 8 emails "bill disputed"; the rep whose commission just went away
    // is the one who needs to know, so the feed follows the contract's owner.
    const emails =
      to === "DISPUTED"
        ? await writeNotifications(tx, [
            templates.billDisputed({
              userId: bill.contract.salesOwnerId,
              billId: id,
              billNumber: bill.billNumber,
              reason: ctx.reason ?? null,
            }),
          ])
        : [];

    return { row: await readBack(tx, id), emails };
  });

  await enqueueNotificationEmails(emails);
  return row;
}

async function readBack(tx: Tx, id: string): Promise<BillRow> {
  const row = await tx.bill.findUnique({ where: { id }, select: ROW_SELECT });
  if (!row) throw notFound("BILL_NOT_FOUND");
  return toRow(row);
}

export const verifyBill = (actor: Actor, id: string, ctx: BillMutationContext = {}) =>
  transitionBill(actor, id, "VERIFIED", ctx);

export const disputeBill = (actor: Actor, id: string, ctx: BillMutationContext = {}) =>
  transitionBill(actor, id, "DISPUTED", ctx);

export const voidBill = (actor: Actor, id: string, ctx: BillMutationContext = {}) =>
  transitionBill(actor, id, "VOID", ctx);
