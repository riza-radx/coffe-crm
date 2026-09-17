import "server-only";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/api/errors";
import { toDecimalString, type DecimalString } from "@/lib/api/decimal";
import { changedFields, writeAudit } from "@/lib/audit/log";
import { permissionFor } from "@/lib/rbac";
import type { Actor } from "@/lib/rbac/types";
import { orderByFromSort, pageSlice, type Paginated } from "@/lib/validation/list-query";
import { toDateOnly } from "@/lib/validation/common";
import type { CreateClientInput, ListClientsQuery, UpdateClientInput } from "@/lib/validation/clients";

export type ClientRow = {
  id: string;
  name: string;
  type: string;
  city: string | null;
  status: string;
  contactName: string | null;
  contactPhone: string | null;
  acquiredBy: { id: string; name: string };
  createdAt: string;
};

type RawContractSummary = {
  id: string;
  status: string;
  commissionPercentage: { toFixed(dp: number): string };
  startDate: Date;
  endDate: Date | null;
  salesOwner: { id: string; name: string };
};

type RawBillSummary = {
  id: string;
  billNumber: string;
  amount: { toFixed(dp: number): string };
  currency: string;
  billDate: Date;
  status: string;
};

export type ClientDetail = ClientRow & {
  address: string | null;
  contactEmail: string | null;
  taxId: string | null;
  contracts: Array<{
    id: string;
    status: string;
    commissionPercentage: DecimalString;
    startDate: string;
    endDate: string | null;
    salesOwner: { id: string; name: string };
  }>;
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

/**
 * Ownership for a client is `acquiredById` — the rep who brought it in. Scope comes
 * from the "View all clients" row of the RBAC table, and is combined with the
 * caller's filters through `AND` so a `salesOwner` query parameter can never widen it.
 */
function scopeWhere(actor: Actor): Record<string, unknown> {
  const { scope } = permissionFor(actor, "viewAll", "client");
  if (scope === "all") return {};
  if (scope === "own") return { acquiredById: actor.id };
  return { id: "__denied__" };
}

const ROW_SELECT = {
  id: true,
  name: true,
  type: true,
  city: true,
  status: true,
  contactName: true,
  contactPhone: true,
  createdAt: true,
  acquiredBy: { select: { id: true, name: true } },
} as const;

function toRow(row: {
  id: string;
  name: string;
  type: string;
  city: string | null;
  status: string;
  contactName: string | null;
  contactPhone: string | null;
  createdAt: Date;
  acquiredBy: { id: string; name: string };
}): ClientRow {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    city: row.city,
    status: row.status,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    acquiredBy: row.acquiredBy,
    createdAt: toDateOnly(row.createdAt),
  };
}

export async function listClients(
  actor: Actor,
  query: ListClientsQuery,
): Promise<Paginated<ClientRow>> {
  const filters: Record<string, unknown> = {};
  if (query.type) filters.type = query.type;
  if (query.status) filters.status = query.status;
  if (query.city) filters.city = { equals: query.city, mode: "insensitive" };
  if (query.salesOwner) filters.acquiredById = query.salesOwner;
  if (query.search) {
    filters.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { contactName: { contains: query.search, mode: "insensitive" } },
      { city: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const where = { AND: [scopeWhere(actor), filters] };
  const { skip, take } = pageSlice(query.page, query.pageSize);

  const [total, rows] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      select: ROW_SELECT,
      orderBy: orderByFromSort(query.sort),
      skip,
      take,
    }),
  ]);

  return { data: rows.map(toRow), page: query.page, pageSize: query.pageSize, total };
}

export async function getClient(actor: Actor, id: string): Promise<ClientDetail> {
  const where = { AND: [scopeWhere(actor), { id }] };
  const client = await prisma.client.findFirst({
    where,
    select: {
      ...ROW_SELECT,
      address: true,
      contactEmail: true,
      taxId: true,
      contracts: {
        select: {
          id: true,
          status: true,
          commissionPercentage: true,
          startDate: true,
          endDate: true,
          salesOwner: { select: { id: true, name: true } },
        },
        orderBy: { startDate: "desc" },
      },
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
        take: 20,
      },
    },
  });
  if (!client) throw notFound("CLIENT_NOT_FOUND");

  const aggregate = await prisma.bill.aggregate({
    where: { clientId: id, status: { not: "VOID" } },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    ...toRow(client),
    address: client.address,
    contactEmail: client.contactEmail,
    taxId: client.taxId,
    contracts: client.contracts.map((c: RawContractSummary) => ({
      id: c.id,
      status: c.status,
      commissionPercentage: toDecimalString(c.commissionPercentage),
      startDate: toDateOnly(c.startDate),
      endDate: c.endDate ? toDateOnly(c.endDate) : null,
      salesOwner: c.salesOwner,
    })),
    bills: client.bills.map((b: RawBillSummary) => ({
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
export type ClientMutationContext = { ip?: string | null };

/** The fields an audit diff reports on. Contact details and free text are included
 *  because a changed contact is exactly the kind of edit a dispute turns on. */
const AUDITED = [
  "name",
  "type",
  "address",
  "city",
  "contactName",
  "contactPhone",
  "contactEmail",
  "taxId",
  "status",
  "acquiredById",
] as const;

const AUDIT_SELECT = Object.fromEntries(AUDITED.map((field) => [field, true])) as Record<
  (typeof AUDITED)[number],
  true
>;

export async function createClient(
  actor: Actor,
  input: CreateClientInput,
  acquiredById: string,
  ctx: ClientMutationContext = {},
): Promise<ClientRow> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.client.create({
      data: {
        name: input.name,
        type: input.type,
        address: input.address,
        city: input.city,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail || undefined,
        taxId: input.taxId,
        status: input.status,
        acquiredById,
      },
      select: { ...ROW_SELECT, ...AUDIT_SELECT },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      entityType: "CLIENT",
      entityId: created.id,
      action: "CREATE",
      diff: { after: pickAudited(created) },
      ip: ctx.ip,
    });

    return toRow(created);
  });
}

export async function updateClient(
  actor: Actor,
  id: string,
  input: UpdateClientInput,
  ctx: ClientMutationContext = {},
): Promise<ClientRow> {
  return prisma.$transaction(async (tx) => {
    // Re-check visibility with the same scope the list uses, so a rep cannot patch
    // a client they are not allowed to see.
    const existing = await tx.client.findFirst({
      where: { AND: [scopeWhere(actor), { id }] },
      select: { id: true, ...AUDIT_SELECT },
    });
    if (!existing) throw notFound("CLIENT_NOT_FOUND");

    const data = {
      name: input.name,
      type: input.type,
      address: input.address,
      city: input.city,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail || undefined,
      taxId: input.taxId,
      status: input.status,
      ...(input.acquiredById ? { acquiredById: input.acquiredById } : {}),
    };

    const updated = await tx.client.update({
      where: { id },
      data,
      select: { ...ROW_SELECT, ...AUDIT_SELECT },
    });

    const diff = changedFields(pickAudited(existing), pickAudited(data));
    // A PATCH that changes nothing is still a request, but it is not a change:
    // an entry with an empty diff would only add noise to the viewer.
    if (Object.keys(diff.after).length > 0) {
      await writeAudit(tx, {
        actorId: actor.id,
        entityType: "CLIENT",
        entityId: id,
        action: "UPDATE",
        diff,
        ip: ctx.ip,
      });
    }

    return toRow(updated);
  });
}

function pickAudited(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of AUDITED) {
    if (row[field] !== undefined) out[field] = row[field] ?? null;
  }
  return out;
}
