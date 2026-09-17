"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/fetch-json";
import { notificationKeys } from "@/lib/query/keys";

type Delivery = "OFF" | "INSTANT" | "DIGEST";
type Preference = { type: string; inApp: boolean; email: Delivery };
type Payload = { preferences: Preference[] };

const LABELS: Record<string, string> = {
  CONTRACT_EXPIRING: "Kontratë që skadon",
  CONTRACT_EXPIRED: "Kontratë e skaduar",
  BILL_DISPUTED: "Faturë e kontestuar",
  COMMISSION_APPROVED: "Komision i aprovuar",
  COMMISSION_PAID: "Komision i paguar",
  INVITE_ACCEPTED: "Ftesë e pranuar",
};

const DELIVERY: Array<{ value: Delivery; label: string }> = [
  { value: "INSTANT", label: "Menjëherë" },
  { value: "DIGEST", label: "Përmbledhje" },
  { value: "OFF", label: "Pa email" },
];

/** Step 19. The whole set is saved at once — a half-saved form is unexplainable. */
export function NotificationPreferences() {
  const queryClient = useQueryClient();

  const prefs = useQuery({
    queryKey: [...notificationKeys.all, "preferences"],
    queryFn: () => fetchJson<Payload>("/api/notifications/preferences"),
    staleTime: 300_000,
  });

  const save = useMutation({
    mutationFn: (preferences: Preference[]) =>
      fetchJson<Payload>("/api/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({ preferences }),
      }),
    onSuccess: async (data) => {
      queryClient.setQueryData([...notificationKeys.all, "preferences"], data);
      await queryClient.invalidateQueries({ queryKey: notificationKeys.lists() });
    },
  });

  const rows = prefs.data?.preferences ?? [];

  const update = (type: string, patch: Partial<Preference>) => {
    save.mutate(rows.map((row) => (row.type === type ? { ...row, ...patch } : row)));
  };

  if (prefs.isLoading) return <p className="p-2 text-sm text-[var(--muted)]">Duke ngarkuar…</p>;

  return (
    <div className="p-2">
      <p className="mb-2 text-sm text-[var(--muted)]">
        Zgjidh çfarë shfaqet te zilja dhe si vjen me email.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.type} className="border-b border-[var(--border)] pb-2 last:border-b-0">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={row.inApp}
                disabled={save.isPending}
                onChange={(event) => update(row.type, { inApp: event.target.checked })}
              />
              {LABELS[row.type] ?? row.type}
            </label>
            <div className="mt-1 flex gap-1">
              {DELIVERY.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={save.isPending}
                  aria-pressed={row.email === option.value}
                  onClick={() => update(row.type, { email: option.value })}
                  className={
                    row.email === option.value
                      ? "rounded border border-[var(--primary)] px-2 py-0.5 text-xs text-[var(--primary)]"
                      : "rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]"
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {save.isError && (
        <p className="mt-2 text-sm text-[var(--danger)]">Ruajtja dështoi. Provo përsëri.</p>
      )}
      <p className="mt-2 text-xs text-[var(--muted)]">
        Përmbledhja vjen një herë në ditë. Njoftimi ruhet gjithsesi — çelësi i parë
        vendos vetëm nëse shfaqet te zilja.
      </p>
    </div>
  );
}
