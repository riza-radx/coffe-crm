import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("mb-1 block text-sm font-medium", className)} {...props} />;
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm",
        "outline-none focus:border-[var(--primary)]",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm",
        "outline-none focus:border-[var(--primary)]",
        className,
      )}
      {...props}
    />
  );
}

export function Button({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-sm text-[var(--danger)]">{children}</p>;
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6",
        className,
      )}
      {...props}
    />
  );
}
