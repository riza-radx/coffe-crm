"use client";

import { cn } from "@/lib/utils";

export function FilterBar({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mb-4 flex flex-wrap items-end gap-3", className)}>{children}</div>;
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "Të gjitha",
}: {
  label: string;
  value: string;
  onChange: (value: string | null) => void;
  options: readonly string[];
  allLabel?: string;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value || null)}
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterText({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-[var(--muted)]">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value || null)}
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
      />
    </label>
  );
}
