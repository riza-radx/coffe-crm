"use client";

import Link from "next/link";
import { createColumnHelper } from "@tanstack/react-table";
import type { listFeatures } from "@/lib/table/features";
import type { AuditLogRow } from "@/lib/queries/audit-logs";
import { SortableHeader } from "@/components/ui/sortable-header";

const helper = createColumnHelper<typeof listFeatures, AuditLogRow>();

/** The entity types that have a page to open. A commission lives on its bill. */
const HREF: Record<string, (id: string) => string | null> = {
  CLIENT: (id) => `/clients/${id}`,
  CONTRACT: (id) => `/contracts/${id}`,
  BILL: (id) => `/bills/${id}`,
  USER: () => null,
  COMMISSION: () => null,
};

export const auditLogColumns = helper.columns([
  helper.accessor("createdAt", {
    header: ({ column }) => <SortableHeader column={column} label="Kur" />,
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap tabular-nums">{getValue().replace("T", " ").slice(0, 19)}</span>
    ),
  }),
  helper.accessor((row) => row.actor?.name ?? null, {
    id: "actor",
    header: "Kush",
    cell: ({ row }) => row.original.actor?.name ?? <span className="text-[var(--muted)]">sistemi</span>,
  }),
  helper.accessor("action", { header: "Veprimi" }),
  helper.accessor("entityType", { header: "Entiteti" }),
  helper.accessor("entityId", {
    header: "ID",
    cell: ({ row }) => {
      const href = HREF[row.original.entityType]?.(row.original.entityId) ?? null;
      const label = <code className="text-xs">{row.original.entityId}</code>;
      // An entity that was deleted — a reversed commission — keeps its id here but
      // has nothing to open; `entity_id` carries no foreign key on purpose.
      return href ? (
        <Link href={href} className="underline-offset-2 hover:underline">
          {label}
        </Link>
      ) : (
        label
      );
    },
  }),
  helper.accessor("diff", {
    header: "Ndryshimi",
    cell: ({ getValue }) => <DiffCell diff={getValue()} />,
  }),
  helper.accessor("ipAddress", {
    header: "IP",
    cell: ({ getValue }) => getValue() ?? <span className="text-[var(--muted)]">—</span>,
  }),
]);

export const AUDIT_COLUMN_COUNT = auditLogColumns.length;

function DiffCell({ diff }: { diff: Record<string, unknown> | null }) {
  if (!diff) return <span className="text-[var(--muted)]">—</span>;
  const before = asRecord(diff.before);
  const after = asRecord(diff.after);
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (fields.length === 0) return <span className="text-[var(--muted)]">—</span>;

  return (
    <ul className="space-y-0.5 text-xs">
      {fields.map((field) => (
        <li key={field}>
          <span className="text-[var(--muted)]">{field}: </span>
          {field in before && <s className="text-[var(--muted)]">{display(before[field])}</s>}
          {field in before && field in after && " → "}
          {field in after && <span>{display(after[field])}</span>}
        </li>
      ))}
    </ul>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
