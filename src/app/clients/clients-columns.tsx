"use client";

import Link from "next/link";
import { createColumnHelper } from "@tanstack/react-table";
import type { listFeatures } from "@/lib/table/features";
import type { ClientRow } from "@/lib/queries/clients";
import { SortableHeader } from "@/components/ui/sortable-header";
import { StatusBadge } from "@/components/ui/status-badge";

const helper = createColumnHelper<typeof listFeatures, ClientRow>();

export const clientColumns = helper.columns([
  helper.accessor("name", {
    header: ({ column }) => <SortableHeader column={column} label="Klienti" />,
    cell: ({ row }) => (
      <Link href={`/clients/${row.original.id}`} className="font-medium underline-offset-2 hover:underline">
        {row.original.name}
      </Link>
    ),
  }),
  helper.accessor("type", { header: "Tipi" }),
  helper.accessor("city", {
    header: ({ column }) => <SortableHeader column={column} label="Qyteti" />,
    cell: ({ getValue }) => getValue() ?? "—",
  }),
  helper.accessor("status", {
    header: ({ column }) => <SortableHeader column={column} label="Statusi" />,
    cell: ({ getValue }) => <StatusBadge value={getValue()} />,
  }),
  helper.accessor((row) => row.contactName ?? "—", { id: "contact", header: "Kontakti" }),
  helper.accessor((row) => row.acquiredBy.name, { id: "acquiredBy", header: "Sjellë nga" }),
  helper.accessor("createdAt", {
    header: ({ column }) => <SortableHeader column={column} label="Krijuar" />,
  }),
]);

export const CLIENT_COLUMN_COUNT = clientColumns.length;
