"use client";

import Link from "next/link";
import { createColumnHelper } from "@tanstack/react-table";
import type { listFeatures } from "@/lib/table/features";
import type { ContractRow } from "@/lib/queries/contracts";
import { SortableHeader } from "@/components/ui/sortable-header";
import { StatusBadge } from "@/components/ui/status-badge";

const helper = createColumnHelper<typeof listFeatures, ContractRow>();

export const contractColumns = helper.columns([
  helper.accessor((row) => row.client.name, {
    id: "client",
    header: "Klienti",
    cell: ({ row }) => (
      <Link href={`/contracts/${row.original.id}`} className="font-medium underline-offset-2 hover:underline">
        {row.original.client.name}
      </Link>
    ),
  }),
  helper.accessor("startDate", {
    header: ({ column }) => <SortableHeader column={column} label="Fillimi" />,
  }),
  helper.accessor("endDate", {
    header: ({ column }) => <SortableHeader column={column} label="Mbarimi" />,
    cell: ({ getValue }) => getValue() ?? "e hapur",
  }),
  helper.accessor("commissionPercentage", {
    header: "Komisioni",
    cell: ({ getValue }) => `${getValue()}%`,
  }),
  helper.accessor((row) => row.salesOwner.name, { id: "salesOwner", header: "Përfaqësuesi" }),
  helper.accessor("status", {
    header: ({ column }) => <SortableHeader column={column} label="Statusi" />,
    cell: ({ getValue }) => <StatusBadge value={getValue()} />,
  }),
]);

export const CONTRACT_COLUMN_COUNT = contractColumns.length;
