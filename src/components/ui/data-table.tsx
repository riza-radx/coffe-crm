"use client";

import type { ReactTable, RowData } from "@tanstack/react-table";
import type { listFeatures } from "@/lib/table/features";
import { cn } from "@/lib/utils";

export type ListTable<T extends RowData> = ReactTable<typeof listFeatures, T>;

export function DataTable<T extends RowData>({
  table,
  isLoading,
  error,
  emptyMessage = "Asnjë rezultat.",
  columnCount,
}: {
  table: ListTable<T>;
  isLoading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  columnCount: number;
}) {
  const rows = table.getRowModel().rows;

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full text-left text-sm">
        <thead className="text-[var(--muted)]">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-[var(--border)]">
              {group.headers.map((header) => (
                <th key={header.id} scope="col" className="px-4 py-3 font-medium">
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {error ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-8 text-center text-[var(--danger)]">
                {error}
              </td>
            </tr>
          ) : isLoading && rows.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-8 text-center text-[var(--muted)]">
                Duke ngarkuar…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-8 text-center text-[var(--muted)]">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-[var(--border)] last:border-0",
                  isLoading && "opacity-60",
                )}
              >
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
