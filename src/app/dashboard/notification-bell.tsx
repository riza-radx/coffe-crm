"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson, patchJson } from "@/lib/api/fetch-json";
import { notificationKeys } from "@/lib/query/keys";
import type { NotificationRow } from "@/lib/queries/notifications";
import { NotificationPreferences } from "./notification-preferences";

type Feed = { data: NotificationRow[]; total: number; unread: number };

const PARAMS = "?pageSize=10&sort=createdAt:desc";

/** Section 8: "In-app bell + list". The list is the panel this opens. */
export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Preferences live behind the bell rather than on /settings: they are personal,
  // and /settings is the business profile, which only a Super Admin opens.
  const [tab, setTab] = useState<"feed" | "preferences">("feed");

  const feed = useQuery({
    queryKey: notificationKeys.list({ pageSize: 10 }),
    queryFn: () => fetchJson<Feed>(`/api/notifications${PARAMS}`),
    // The bell is read-mostly and cheap; a minute of staleness is invisible to a
    // person and saves a query on every navigation.
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => patchJson<NotificationRow>(`/api/notifications/${id}/read`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      router.refresh();
    },
  });

  const unread = feed.data?.unread ?? 0;
  const rows = feed.data?.data ?? [];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={unread > 0 ? `Njoftimet: ${unread} të palexuara` : "Njoftimet"}
        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
      >
        Njoftimet
        {unread > 0 && (
          <span className="ml-2 rounded-full bg-[var(--primary)] px-2 py-0.5 text-xs text-[var(--primary-foreground)]">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-80 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
          <div className="mb-2 flex gap-2 border-b border-[var(--border)] pb-2">
            {(["feed", "preferences"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
                className={
                  tab === value
                    ? "rounded border border-[var(--primary)] px-2 py-0.5 text-xs text-[var(--primary)]"
                    : "rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]"
                }
              >
                {value === "feed" ? "Njoftimet" : "Preferencat"}
              </button>
            ))}
          </div>

          {tab === "preferences" && <NotificationPreferences />}

          {tab === "feed" && feed.isLoading && <p className="p-2 text-sm text-[var(--muted)]">Duke ngarkuar…</p>}
          {tab === "feed" && !feed.isLoading && rows.length === 0 && (
            <p className="p-2 text-sm text-[var(--muted)]">Asnjë njoftim.</p>
          )}
          <ul className={tab === "feed" ? "max-h-96 overflow-y-auto" : "hidden"}>
            {rows.map((row) => (
              <li
                key={row.id}
                className="border-b border-[var(--border)] p-2 last:border-b-0"
                data-unread={row.readAt === null || undefined}
              >
                <p className={row.readAt ? "text-sm" : "text-sm font-medium"}>{row.title}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">{row.body}</p>
                <div className="mt-1 flex items-center justify-between">
                  <time className="text-xs text-[var(--muted)]">{row.createdAt.slice(0, 10)}</time>
                  {!row.readAt && (
                    <button
                      type="button"
                      className="text-xs underline-offset-2 hover:underline"
                      onClick={() => markRead.mutate(row.id)}
                      disabled={markRead.isPending}
                    >
                      Shënoje si të lexuar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
