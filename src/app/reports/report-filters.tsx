import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Both filters live in the URL, like every other filter in the app, so a report
 * view is shareable — and plain links keep this page free of client JavaScript.
 */
export function ReportFilters({
  month,
  months,
  horizon,
  horizons,
}: {
  month: string;
  months: Array<{ value: string; label: string }>;
  horizon: number;
  horizons: number[];
}) {
  return (
    <div className="mt-6 space-y-3">
      <nav className="flex flex-wrap items-center gap-2" aria-label="Muaji">
        <span className="text-sm text-[var(--muted)]">Muaji:</span>
        {months.map((option) => (
          <Link
            key={option.value}
            href={`?month=${option.value}&horizon=${horizon}`}
            aria-current={option.value === month ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              option.value === month
                ? "border-[var(--primary)] text-[var(--primary)]"
                : "border-[var(--border)] text-[var(--muted)]",
            )}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <nav className="flex flex-wrap items-center gap-2" aria-label="Horizonti i skadimit">
        <span className="text-sm text-[var(--muted)]">Skadime brenda:</span>
        {horizons.map((days) => (
          <Link
            key={days}
            href={`?month=${month}&horizon=${days}`}
            aria-current={days === horizon ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              days === horizon
                ? "border-[var(--primary)] text-[var(--primary)]"
                : "border-[var(--border)] text-[var(--muted)]",
            )}
          >
            {days} ditë
          </Link>
        ))}
      </nav>
    </div>
  );
}
