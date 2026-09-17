import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  ACTIVE: "border-[var(--primary)] text-[var(--primary)]",
  VERIFIED: "border-[var(--primary)] text-[var(--primary)]",
  APPROVED: "border-[var(--primary)] text-[var(--primary)]",
  PAID: "border-[var(--primary)] text-[var(--primary)]",
  DRAFT: "border-[var(--border)] text-[var(--muted)]",
  PENDING: "border-[var(--border)] text-[var(--muted)]",
  LEAD: "border-[var(--border)] text-[var(--muted)]",
  INACTIVE: "border-[var(--border)] text-[var(--muted)]",
  EXPIRED: "border-[var(--border)] text-[var(--muted)]",
  RENEWED: "border-[var(--border)] text-[var(--muted)]",
  LOST: "border-[var(--danger)] text-[var(--danger)]",
  TERMINATED: "border-[var(--danger)] text-[var(--danger)]",
  DISPUTED: "border-[var(--danger)] text-[var(--danger)]",
  VOID: "border-[var(--danger)] text-[var(--danger)]",
};

export function StatusBadge({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border px-2 py-0.5 text-xs",
        TONE[value] ?? "border-[var(--border)] text-[var(--muted)]",
      )}
    >
      {value}
    </span>
  );
}
