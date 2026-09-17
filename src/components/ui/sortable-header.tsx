"use client";

type SortableColumn = {
  getIsSorted: () => false | "asc" | "desc";
  toggleSorting: (desc?: boolean, isMulti?: boolean) => void;
};

const ARROW = { asc: "↑", desc: "↓" } as const;

/** Header button for a server-sorted column; the click writes the URL, not client state. */
export function SortableHeader({ column, label }: { column: SortableColumn; label: string }) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : "none"}
      className="inline-flex items-center gap-1 font-medium hover:text-[var(--foreground)]"
    >
      {label}
      <span aria-hidden className="text-xs">
        {sorted ? ARROW[sorted] : "↕"}
      </span>
    </button>
  );
}
