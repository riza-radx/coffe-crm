import type { Tx } from "@/lib/db";

export type AuditEntityType = "CONTRACT" | "BILL" | "CLIENT" | "USER" | "COMMISSION";

/** CREATE/UPDATE/DELETE from section 2, plus the money actions of Phase 3. */
export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "STATUS_CHANGE"
  | "VERIFY"
  | "DISPUTE"
  | "VOID"
  | "APPROVE"
  | "PAY";

export type AuditEntry = {
  actorId: string | null;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  /** `{ before }` for a delete, `{ after }` for a create, both for an update. */
  diff?: Record<string, unknown>;
  ip?: string | null;
};

/**
 * The only writer of audit_logs.
 *
 * It takes the transaction client rather than importing `prisma`, which is the
 * mechanical guarantee the plan asks for: an audit entry cannot be written
 * outside the transaction that made the change it describes, and a failed
 * mutation leaves no entry behind.
 */
export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({ data: toRow(entry) });
}

/** One row per entity, one statement — used by batch approval. */
export async function writeAuditMany(tx: Tx, entries: readonly AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await tx.auditLog.createMany({ data: entries.map(toRow) });
}

function toRow(entry: AuditEntry) {
  return {
    actorId: entry.actorId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    diff: (entry.diff ?? null) as never,
    ipAddress: entry.ip ?? null,
  };
}

/** The changed fields only, so an update's diff does not repeat the whole row. */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  for (const key of Object.keys(after) as Array<keyof T>) {
    if (after[key] !== undefined && after[key] !== before[key]) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return { before: changedBefore, after: changedAfter };
}
