"use client";

import Link from "next/link";
import { createColumnHelper } from "@tanstack/react-table";
import type { listFeatures } from "@/lib/table/features";
import type { CommissionRow } from "@/lib/queries/commissions";
import { SortableHeader } from "@/components/ui/sortable-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDecimal } from "@/lib/api/decimal";
import { CommissionActions } from "./commission-actions";

const helper = createColumnHelper<typeof listFeatures, CommissionRow>();

export type CommissionColumnOptions = {
  canApprove: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
};

/**
 * Built per render rather than at module scope because the selection checkbox and
 * the action buttons need the page's state; `listFeatures` registers no row
 * selection feature, and adding one would change every other table in the app.
 */
export function commissionColumns({ canApprove, selected, onToggle }: CommissionColumnOptions) {
  const columns = [
    ...(canApprove
      ? [
          helper.display({
            id: "select",
            header: "",
            cell: ({ row }) => (
              <input
                type="checkbox"
                aria-label={`Zgjidh komisionin ${row.original.id}`}
                checked={selected.has(row.original.id)}
                disabled={row.original.status !== "PENDING"}
                onChange={() => onToggle(row.original.id)}
              />
            ),
          }),
        ]
      : []),
    helper.accessor((row) => row.bill.billNumber, {
      id: "bill",
      header: "Fatura",
      cell: ({ row }) => (
        <Link href={`/bills/${row.original.bill.id}`} className="underline-offset-2 hover:underline">
          {row.original.bill.billNumber}
        </Link>
      ),
    }),
    helper.accessor((row) => row.bill.client.name, { id: "client", header: "Klienti" }),
    helper.accessor((row) => row.bill.billDate, { id: "billDate", header: "Data e faturës" }),
    helper.accessor((row) => row.salesUser.name, { id: "salesUser", header: "Përfaqësuesi" }),
    helper.accessor("baseAmount", {
      header: "Baza",
      cell: ({ getValue }) => formatDecimal(getValue()),
    }),
    helper.accessor("commissionPercentageSnapshot", {
      header: "%",
      cell: ({ getValue }) => `${getValue()}%`,
    }),
    helper.accessor("commissionAmount", {
      header: ({ column }) => <SortableHeader column={column} label="Komisioni" />,
      cell: ({ getValue }) => formatDecimal(getValue()),
    }),
    helper.accessor("status", {
      header: ({ column }) => <SortableHeader column={column} label="Statusi" />,
      cell: ({ getValue }) => <StatusBadge value={getValue()} />,
    }),
    ...(canApprove
      ? [
          helper.display({
            id: "actions",
            header: "",
            cell: ({ row }) => <CommissionActions commission={row.original} />,
          }),
        ]
      : []),
  ];

  return helper.columns(columns);
}
