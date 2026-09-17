import { cn } from "@/lib/utils";

/**
 * Two or three numbers with no shape to compare are a figure, not a chart. The
 * tile is the form: a label, the value, and an optional line of context.
 *
 * Proportional figures on the value — `tabular-nums` gives every digit the width
 * of a zero, which reads loose at this size. Columns of numbers get tabular; a
 * standalone figure does not.
 */
export function StatTile({
  label,
  value,
  note,
  accent,
  className,
}: {
  label: string;
  value: string;
  note?: string;
  /** A colored rule, for a tile that belongs to a series elsewhere on the page. */
  accent?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4",
        className,
      )}
    >
      {accent && (
        <span
          aria-hidden
          className="mb-2 block h-1 w-8 rounded-full"
          style={{ background: accent }}
        />
      )}
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-xs text-[var(--muted)]">{note}</p>}
    </div>
  );
}
