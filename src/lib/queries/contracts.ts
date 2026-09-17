import "server-only";
import { prisma } from "@/lib/db";
import { conflict, forbidden, notFound } from "@/lib/api/errors";
import { toDecimalString, type DecimalString } from "@/lib/api/decimal";
import { changedFields, writeAudit, type AuditEntry } from "@/lib/audit/log";
import { can, permissionFor } from "@/lib/rbac";
import type { Actor } from "@/lib/rbac/types";
import { orderByFromSort, pageSlice, type Paginated } from "@/lib/validation/list-query";
import { toDateOnly, toUtcDate } from "@/lib/validation/common";
import { checkTransition, type ContractStatus } from "@/lib/contracts/state-machine";
import { CONTRACT_EXPORT_LIMIT } from "@/lib/validation/contracts";
import type {
  CreateContractInput,
  ExportContractsQuery,
  ListContractsQuery,
  RenewContractInput,
  TerminateContractInput,
  UpdateContractInput,
} from "@/lib/validation/contracts";

export type ContractRow = {
  id: string;
  status: string;
  commissionPercentage: DecimalString;
  startDate: string;
  endDate: string | null;
  client: { id: string; name: string };
  salesOwner: { id: string; name: string };
  createdAt: string;
};

type RawBillSummary = {
  id: string;
  billNumber: string;
  amount: { toFixed(dp: number): string };
  currency: string;
  billDate: Date;
  status: string;
};

export type ContractDetail = ContractRow & {
  paymentTerms: string | null;
  notes: string | null;
  signedDocumentUrl: string | null;
  previousContractId: string | null;
  bills: Array<{
    id: string;
    billNumber: string;
    amount: DecimalString;
    currency: string;
    billDate: string;
    status: string;
  }>;
  totals: { billCount: number; billedAmount: DecimalString };
};

/** Ownership for a contract is `salesOwnerId` ("View all contracts" row of the table). */
function scopeWhere(actor: Actor): Record<string, unknown> {
  const { scope } = permissionFor(actor, "viewAll", "contract");
  if (scope === "all") return {};
  if (scope === "own") return { salesOwnerId: actor.id };
  return { id: "__denied__" };
}

const ROW_SELECT = {
  id: true,
  status: true,
  commissionPercentage: true,
  startDate: true,
  endDate: true,
  createdAt: true,
  client: { select: { id: true, name: true } },
  salesOwner: { select: { id: true, name: true } },
} as const;

type RawRow = {
  id: string;
  status: string;
  commissionPercentage: { toFixed(dp: number): string };
  startDate: Date;
  endDate: Date | null;
  createdAt: Date;
  client: { id: string; name: string };
  salesOwner: { id: string; name: string };
};

function toRow(row: RawRow): ContractRow {
  return {
    id: row.id,
    status: row.status,
    commissionPercentage: toDecimalString(row.commissionPercentage),
    startDate: toDateOnly(row.startDate),
    endDate: row.endDate ? toDateOnly(row.endDate) : null,
    client: row.client,
    salesOwner: row.salesOwner,
    createdAt: toDateOnly(row.createdAt),
  };
}

/** Shared by the list and the expiry report, so the two cannot select differently. */
function contractFilters(query: ListContractsQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  if (query.clientId) filters.clientId = query.clientId;
  if (query.status) filters.status = query.status;
  if (query.salesOwner) filters.salesOwnerId = query.salesOwner;
  // An open-ended contract has no expiry, so `not: null` is part of the question,
  // not an optimisation: without it Postgres would drop those rows anyway and the
  // reader would be left wondering whether they were filtered or missing.
  if (query.expiringBefore) {
    filters.endDate = { not: null, lte: toUtcDate(query.expiringBefore) };
  }
  return filters;
}

export async function listContracts(
  actor: Actor,
  query: ListContractsQuery,
): Promise<Paginated<ContractRow>> {
  const where = { AND: [scopeWhere(actor), contractFilters(query)] };
  const { skip, take } = pageSlice(query.page, query.pageSize);

  const [total, rows] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.findMany({
      where,
      select: ROW_SELECT,
      orderBy: orderByFromSort(query.sort),
      skip,
      take,
    }),
  ]);

  return { data: rows.map(toRow), page: query.page, pageSize: query.pageSize, total };
}

/**
 * The contract expiry list of section 8. Ordered by end date, soonest first —
 * the order the report is read in, not the list's default.
 */
export const CONTRACT_REPORT_COLUMNS = [
  { header: "Mbaron më", width: 11 },
  { header: "Klienti", width: 24 },
  { header: "Përfaqësuesi", width: 20 },
  { header: "Filloi më", width: 11 },
  { header: "Komisioni %", width: 10, align: "right" as const },
  { header: "Statusi", width: 12 },
  { header: "Ditë të mbetura", width: 12, align: "right" as const },
];

export async function exportContracts(
  actor: Actor,
  query: ExportContractsQuery,
  today: Date = new Date(),
): Promise<{ rows: string[][]; truncated: boolean }> {
  const rows = (await prisma.contract.findMany({
    where: { AND: [scopeWhere(actor), contractFilters(query)] },
    select: ROW_SELECT,
    orderBy: [{ endDate: "asc" }, { id: "asc" }],
    take: CONTRACT_EXPORT_LIMIT + 1,
  })) as RawRow[];

  const truncated = rows.length > CONTRACT_EXPORT_LIMIT;
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  return {
    truncated,
    rows: rows.slice(0, CONTRACT_EXPORT_LIMIT).map((raw) => {
      const row = toRow(raw);
      const daysLeft =
        raw.endDate === null
          ? ""
          : String(Math.round((Date.parse(`${row.endDate}T00:00:00.000Z`) - midnight) / 86_400_000));
      return [
        row.endDate ?? "e hapur",
        row.client.name,
        row.salesOwner.name,
        row.startDate,
        row.commissionPercentage,
        row.status,
        daysLeft,
      ];
    }),
  };
}

export async function getContract(actor: Actor, id: string): Promise<ContractDetail> {
  const contract = await prisma.contract.findFirst({
    where: { AND: [scopeWhere(actor), { id }] },
    select: {
      ...ROW_SELECT,
      paymentTerms: true,
      notes: true,
      signedDocumentUrl: true,
      previousContractId: true,
      bills: {
        select: {
          id: true,
          billNumber: true,
          amount: true,
          currency: true,
          billDate: true,
          status: true,
        },
        orderBy: { billDate: "desc" },
        take: 50,
      },
    },
  });
  if (!contract) throw notFound("CONTRACT_NOT_FOUND");

  const aggregate = await prisma.bill.aggregate({
    where: { contractId: id, status: { not: "VOID" } },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    ...toRow(contract),
    paymentTerms: contract.paymentTerms,
    notes: contract.notes,
    signedDocumentUrl: contract.signedDocumentUrl,
    previousContractId: contract.previousContractId,
    bills: contract.bills.map((b: RawBillSummary) => ({
      id: b.id,
      billNumber: b.billNumber,
      amount: toDecimalString(b.amount),
      currency: b.currency,
      billDate: toDateOnly(b.billDate),
      status: b.status,
    })),
    totals: {
      billCount: aggregate._count._all,
      billedAmount: toDecimalString(aggregate._sum.amount ?? "0"),
    },
  };
}

/** Phase 4: every mutation carries the request's IP into its audit entry. */
export type ContractMutationContext = { ip?: string | null };

export async function createContract(
  actor: Actor,
  input: CreateContractInput,
  ctx: ContractMutationContext = {},
): Promise<ContractRow> {
  const ownScopeOnly = permissionFor(actor, "create", "contract").scope === "own";
  const salesOwnerId = ownScopeOnly ? actor.id : (input.salesOwnerId ?? actor.id);

  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { AND: [{ id: input.clientId }, ownScopeOnly ? { acquiredById: actor.id } : {}] },
      select: { id: true },
    });
    if (!client) throw notFound("CLIENT_NOT_FOUND");

    const created = await tx.contract.create({
    data: {
      clientId: input.clientId,
      salesOwnerId,
      // Frozen at creation; only a Super Admin may amend it afterwards.
      commissionPercentage: input.commissionPercentage,
      startDate: toUtcDate(input.startDate),
      endDate: input.endDate ? toUtcDate(input.endDate) : null,
      paymentTerms: input.paymentTerms,
      notes: input.notes,
      signedDocumentUrl: input.signedDocumentUrl,
      // Every contract starts as DRAFT; bills cannot attach until it is ACTIVE.
      status: "DRAFT",
    },
    select: ROW_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      entityType: "CONTRACT",
      entityId: created.id,
      action: "CREATE",
      diff: {
        after: {
          clientId: input.clientId,
          salesOwnerId,
          commissionPercentage: input.commissionPercentage,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          status: "DRAFT",
        },
      },
      ip: ctx.ip,
    });

    return toRow(created);
  });
}

export async function updateContract(
  actor: Actor,
  id: string,
  input: UpdateContractInput,
  ctx: ContractMutationContext = {},
): Promise<ContractRow> {
  return prisma.$transaction(async (tx) => {
  const existing = await tx.contract.findFirst({
    where: { AND: [scopeWhere(actor), { id }] },
    select: {
      id: true,
      status: true,
      salesOwnerId: true,
      commissionPercentage: true,
      startDate: true,
      endDate: true,
      paymentTerms: true,
      notes: true,
      signedDocumentUrl: true,
    },
  });
  if (!existing) throw notFound("CONTRACT_NOT_FOUND");

  const data: Record<string, unknown> = {};

  if (input.commissionPercentage !== undefined) {
    // Section 7: "Edit commission %" is Super Admin only, and section 6 requires an
    // explicit amend rather than a silent edit — which is why Phase 4 logs it as its
    // own entry, apart from the ordinary field edits in the same PATCH.
    if (!can(actor, "editCommissionPercentage", "contract")) throw forbidden("COMMISSION_EDIT_FORBIDDEN");
    data.commissionPercentage = input.commissionPercentage;
  }

  if (input.status !== undefined) {
    const verdict = checkTransition(existing.status as ContractStatus, input.status);
    if (!verdict.ok) throw conflict(`TRANSITION_${verdict.code}`, { from: existing.status, to: input.status });
    data.status = input.status;
  }

  if (input.salesOwnerId !== undefined) {
    // Reassigning a contract moves commission attribution, so it stays with the role
    // that owns commission decisions. The plan does not spell this row out.
    if (!can(actor, "editCommissionPercentage", "contract")) throw forbidden("REASSIGN_FORBIDDEN");
    data.salesOwnerId = input.salesOwnerId;
  }

  if (input.startDate !== undefined) data.startDate = toUtcDate(input.startDate);
  if (input.endDate !== undefined) data.endDate = input.endDate ? toUtcDate(input.endDate) : null;
  if (input.paymentTerms !== undefined) data.paymentTerms = input.paymentTerms;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.signedDocumentUrl !== undefined) data.signedDocumentUrl = input.signedDocumentUrl;

  const updated = await tx.contract.update({ where: { id }, data, select: ROW_SELECT });

  for (const entry of contractAuditEntries(actor, id, existing, input, ctx)) {
    await writeAudit(tx, entry);
  }

  return toRow(updated);
  });
}

/**
 * Renewal and termination are role-gated rows of their own in section 7
 * ("Terminate/renew contract — Yes / Yes (own, with limits) / No"), so the
 * ownership predicate comes from that row and not from the read row. A rep who
 * may *see* every contract still may only renew the ones they own.
 */
function actionScopeWhere(actor: Actor, action: "renew" | "terminate"): Record<string, unknown> {
  const { scope } = permissionFor(actor, action, "contract");
  if (scope === "all") return {};
  if (scope === "own") return { salesOwnerId: actor.id };
  return { id: "__denied__" };
}

export type RenewResult = { previous: ContractRow; contract: ContractRow };

/**
 * Section 6: "RENEWED — old contract closes, previous_contract_id links to the
 * new one, preserving full history per client."
 *
 * Both moves happen in one transaction, so a client is never left with two ACTIVE
 * contracts or with none. The successor is created DRAFT and then activated
 * through the same state machine rather than being inserted as ACTIVE: the
 * diagram's only way into ACTIVE is DRAFT→ACTIVE, and the audit trail shows both
 * steps.
 */
export async function renewContract(
  actor: Actor,
  id: string,
  input: RenewContractInput,
  ctx: ContractMutationContext = {},
): Promise<RenewResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.contract.findFirst({
      where: { AND: [actionScopeWhere(actor, "renew"), { id }] },
      select: {
        id: true,
        status: true,
        clientId: true,
        salesOwnerId: true,
        commissionPercentage: true,
        endDate: true,
        paymentTerms: true,
        notes: true,
        renewedInto: { select: { id: true } },
      },
    });
    if (!existing) throw notFound("CONTRACT_NOT_FOUND");

    const verdict = checkTransition(existing.status as ContractStatus, "RENEWED", "renew");
    if (!verdict.ok) throw conflict(`TRANSITION_${verdict.code}`, { from: existing.status, to: "RENEWED" });

    // previous_contract_id is unique, so the database would refuse a second
    // renewal anyway — this turns that into an answer instead of a 500.
    if (existing.renewedInto) throw conflict("ALREADY_RENEWED", { contractId: existing.renewedInto.id });

    const inheritedPercentage = toDecimalString(existing.commissionPercentage);
    let commissionPercentage = inheritedPercentage;
    if (input.commissionPercentage !== undefined) {
      const requested = toDecimalString(input.commissionPercentage);
      if (requested !== inheritedPercentage && !can(actor, "editCommissionPercentage", "contract")) {
        throw forbidden("COMMISSION_EDIT_FORBIDDEN");
      }
      commissionPercentage = requested;
    }

    const draft = await tx.contract.create({
      data: {
        clientId: existing.clientId,
        salesOwnerId: existing.salesOwnerId,
        commissionPercentage,
        startDate: toUtcDate(input.startDate),
        endDate: input.endDate ? toUtcDate(input.endDate) : null,
        paymentTerms: input.paymentTerms ?? existing.paymentTerms,
        notes: input.notes ?? existing.notes,
        signedDocumentUrl: input.signedDocumentUrl,
        previousContractId: existing.id,
        status: "DRAFT",
      },
      select: { id: true },
    });

    const activation = checkTransition("DRAFT", "ACTIVE", "patch");
    if (!activation.ok) throw conflict(`TRANSITION_${activation.code}`, { from: "DRAFT", to: "ACTIVE" });

    const created = await tx.contract.update({
      where: { id: draft.id },
      data: { status: "ACTIVE" },
      select: ROW_SELECT,
    });

    const closed = await tx.contract.update({
      where: { id: existing.id },
      data: { status: "RENEWED" },
      select: ROW_SELECT,
    });

    const base = { actorId: actor.id, entityType: "CONTRACT" as const, ip: ctx.ip };
    await writeAudit(tx, {
      ...base,
      entityId: draft.id,
      action: "CREATE",
      diff: {
        renewalOf: existing.id,
        after: {
          clientId: existing.clientId,
          salesOwnerId: existing.salesOwnerId,
          commissionPercentage,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          previousContractId: existing.id,
          status: "DRAFT",
        },
      },
    });
    await writeAudit(tx, {
      ...base,
      entityId: draft.id,
      action: "STATUS_CHANGE",
      diff: { before: { status: "DRAFT" }, after: { status: "ACTIVE" }, renewalOf: existing.id },
    });
    await writeAudit(tx, {
      ...base,
      entityId: existing.id,
      action: "STATUS_CHANGE",
      diff: {
        before: { status: existing.status },
        after: { status: "RENEWED" },
        renewedIntoId: draft.id,
      },
    });

    return { previous: toRow(closed), contract: toRow(created) };
  });
}

/**
 * Section 6: termination is a manual action and "requires a reason field".
 *
 * The reason lives in the audit entry rather than in a new contracts column: the
 * plan's section 2 lists the columns of `contracts`, and none of them is a
 * termination reason, while audit_logs exists precisely to answer "who did this,
 * when, and with what payload".
 */
export async function terminateContract(
  actor: Actor,
  id: string,
  input: TerminateContractInput,
  ctx: ContractMutationContext = {},
): Promise<ContractRow> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.contract.findFirst({
      where: { AND: [actionScopeWhere(actor, "terminate"), { id }] },
      select: { id: true, status: true },
    });
    if (!existing) throw notFound("CONTRACT_NOT_FOUND");

    const verdict = checkTransition(existing.status as ContractStatus, "TERMINATED", "terminate");
    if (!verdict.ok) throw conflict(`TRANSITION_${verdict.code}`, { from: existing.status, to: "TERMINATED" });

    const moved = await tx.contract.updateMany({
      where: { id, status: existing.status },
      data: { status: "TERMINATED" },
    });
    if (moved.count !== 1) throw conflict("CONTRACT_CONCURRENT_MODIFICATION");

    await writeAudit(tx, {
      actorId: actor.id,
      entityType: "CONTRACT",
      entityId: id,
      action: "STATUS_CHANGE",
      diff: {
        before: { status: existing.status },
        after: { status: "TERMINATED" },
        reason: input.reason,
      },
      ip: ctx.ip,
    });

    const row = await tx.contract.findUnique({ where: { id }, select: ROW_SELECT });
    if (!row) throw notFound("CONTRACT_NOT_FOUND");
    return toRow(row);
  });
}

type ExistingContract = {
  status: string;
  salesOwnerId: string;
  commissionPercentage: { toFixed(dp: number): string };
  startDate: Date;
  endDate: Date | null;
  paymentTerms: string | null;
  notes: string | null;
  signedDocumentUrl: string | null;
};

/**
 * One PATCH carries up to three different kinds of change, and the audit table reads
 * badly if they share an action: a status move, an amendment of the commission
 * percentage, and ordinary field edits each get their own entry. "Who amended the
 * percentage, and when" is then a query on `action` and `diff.amend`, not a scan.
 */
function contractAuditEntries(
  actor: Actor,
  id: string,
  existing: ExistingContract,
  input: UpdateContractInput,
  ctx: ContractMutationContext,
): AuditEntry[] {
  const base = { actorId: actor.id, entityType: "CONTRACT" as const, entityId: id, ip: ctx.ip };
  const entries: AuditEntry[] = [];

  if (input.status !== undefined && input.status !== existing.status) {
    entries.push({
      ...base,
      action: "STATUS_CHANGE",
      diff: { before: { status: existing.status }, after: { status: input.status } },
    });
  }

  if (input.commissionPercentage !== undefined) {
    const before = toDecimalString(existing.commissionPercentage);
    const after = toDecimalString(input.commissionPercentage);
    if (before !== after) {
      entries.push({
        ...base,
        action: "UPDATE",
        diff: {
          amend: "commissionPercentage",
          before: { commissionPercentage: before },
          after: { commissionPercentage: after },
        },
      });
    }
  }

  const fieldDiff = changedFields<Record<string, unknown>>(
    {
      salesOwnerId: existing.salesOwnerId,
      startDate: toDateOnly(existing.startDate),
      endDate: existing.endDate ? toDateOnly(existing.endDate) : null,
      paymentTerms: existing.paymentTerms,
      notes: existing.notes,
      signedDocumentUrl: existing.signedDocumentUrl,
    },
    {
      salesOwnerId: input.salesOwnerId,
      startDate: input.startDate,
      endDate: input.endDate,
      paymentTerms: input.paymentTerms,
      notes: input.notes,
      signedDocumentUrl: input.signedDocumentUrl,
    },
  );
  if (Object.keys(fieldDiff.after).length > 0) {
    entries.push({ ...base, action: "UPDATE", diff: fieldDiff });
  }

  return entries;
}
