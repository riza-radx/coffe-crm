import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The period lives in the URL, like every other filter in the app, so a standings
 * view is shareable. Plain links rather than a select: three to five choices, and
 * a link needs no client JavaScript on a page that is otherwise fully server-rendered.
 */
export function PeriodFilter({
  current,
  options,
}: {
  current: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <nav className="mb-6 flex flex-wrap gap-2" aria-label="Periudha">
      {options.map((option) => (
        <Link
          key={option.value}
          href={`?period=${option.value}`}
          aria-current={option.value === current ? "page" : undefined}
          className={cn(
            "rounded-md border px-3 py-1.5 text-sm",
            option.value === current
              ? "border-[var(--primary)] text-[var(--primary)]"
              : "border-[var(--border)] text-[var(--muted)]",
          )}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

/** This month, the two before it, the current quarter and the current year. */
export function periodOptions(now: Date): Array<{ value: string; label: string }> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const months = [0, 1, 2].map((back) => {
    const date = new Date(Date.UTC(year, month - back, 1));
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return { value, label: value };
  });

  const quarter = Math.floor(month / 3) + 1;
  return [
    ...months,
    { value: `${year}-Q${quarter}`, label: `${year} Q${quarter}` },
    { value: String(year), label: String(year) },
  ];
}
