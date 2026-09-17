"use client";

import type { RowData } from "@tanstack/react-table";
import type { ListTable } from "./data-table";

export function DataTablePagination<T extends RowData>({
  table,
  total,
}: {
  table: ListTable<T>;
  total: number;
}) {
  const { pageIndex, pageSize } = table.state.pagination ?? { pageIndex: 0, pageSize: 25 };
  const pageCount = Math.max(table.getPageCount(), 1);
  const first = total === 0 ? 0 : pageIndex * pageSize + 1;
  const last = Math.min((pageIndex + 1) * pageSize, total);

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-[var(--muted)]">
        {first}–{last} nga {total}
      </p>
      <div className="flex items-center gap-2">
        <label className="text-[var(--muted)]" htmlFor="pageSize">
          Rreshta
        </label>
        <select
          id="pageSize"
          value={pageSize}
          onChange={(event) => table.setPageSize(Number(event.target.value))}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1"
        >
          {[10, 25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="rounded-md border border-[var(--border)] px-3 py-1 disabled:opacity-40"
        >
          Para
        </button>
        <span className="text-[var(--muted)]">
          {pageIndex + 1} / {pageCount}
        </span>
        <button
          type="button"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="rounded-md border border-[var(--border)] px-3 py-1 disabled:opacity-40"
        >
          Pas
        </button>
      </div>
    </div>
  );
}
