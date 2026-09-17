"use client";

import Link from "next/link";
import { createColumnHelper } from "@tanstack/react-table";
import type { listFeatures } from "@/lib/table/features";
import type { BillRow } from "@/lib/queries/bills";
import { SortableHeader } from "@/components/ui/sortable-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDecimal } from "@/lib/api/decimal";

const helper = createColumnHelper<typeof listFeatures, BillRow>();

export const billColumns = helper.columns([
  helper.accessor("billNumber", { header: "Numri" }),
  helper.accessor((row) => row.client.name, {
    id: "client",
    header: "Klienti",
    cell: ({ row }) => (
      <Link href={`/clients/${row.original.client.id}`} className="underline-offset-2 hover:underline">
        {row.original.client.name}
      </Link>
    ),
  }),
  helper.accessor("billDate", {
    header: ({ column }) => <SortableHeader column={column} label="Data" />,
  }),
  helper.accessor("amount", {
    header: ({ column }) => <SortableHeader column={column} label="Vlera" />,
    cell: ({ row }) => `${formatDecimal(row.original.amount)} ${row.original.currency}`,
  }),
  helper.accessor((row) => row.enteredBy.name, { id: "enteredBy", header: "Regjistruar nga" }),
  helper.accessor("status", {
    header: ({ column }) => <SortableHeader column={column} label="Statusi" />,
    cell: ({ getValue }) => <StatusBadge value={getValue()} />,
  }),
  helper.accessor((row) => row.commission?.commissionAmount ?? null, {
    id: "commission",
    header: "Komisioni",
    cell: ({ row }) =>
      row.original.commission ? (
        <span className="whitespace-nowrap">
          {formatDecimal(row.original.commission.commissionAmount)}{" "}
          <StatusBadge value={row.original.commission.status} />
        </span>
      ) : (
        <span className="text-[var(--muted)]">—</span>
      ),
  }),
  helper.display({
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <Link href={`/bills/${row.original.id}`} className="underline-offset-2 hover:underline">
        Detaje
      </Link>
    ),
  }),
]);

export const BILL_COLUMN_COUNT = billColumns.length;
