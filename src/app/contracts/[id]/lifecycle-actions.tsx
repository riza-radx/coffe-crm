"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postJson, ApiRequestError } from "@/lib/api/fetch-json";
import { contractKeys } from "@/lib/query/keys";
import { Button, FieldError, Input, Label } from "@/components/ui/field";

const ERRORS: Record<string, string> = {
  TRANSITION_SAME_STATUS: "Kontrata është tashmë në këtë status.",
  TRANSITION_INVALID_TRANSITION: "Vetëm një kontratë ACTIVE mund të rinovohet ose ndërpritet.",
  TRANSITION_WRONG_CHANNEL: "Ky kalim bëhet nga veprimi i vet.",
  ALREADY_RENEWED: "Kjo kontratë është rinovuar një herë; hap kontratën pasardhëse.",
  COMMISSION_EDIT_FORBIDDEN: "Vetëm Super Admin mund ta ndryshojë përqindjen e komisionit.",
  CONTRACT_NOT_FOUND: "Kontrata nuk u gjet.",
  VALIDATION_ERROR: "Kontrollo fushat e formularit.",
};

function message(error: unknown): string {
  if (error instanceof ApiRequestError) return ERRORS[error.code] ?? error.code;
  return "Veprimi dështoi.";
}

/**
 * The two Phase 5 actions of section 4, each posting to its own endpoint.
 * They show only for a contract the state machine can actually move, and only to
 * a role the RBAC table allows — but the server decides either way.
 */
export function LifecycleActions({ contractId }: { contractId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<"renew" | "terminate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const done = async () => {
    setError(null);
    setOpen(null);
    await queryClient.invalidateQueries({ queryKey: contractKeys.all });
    router.refresh();
  };

  const renew = useMutation({
    mutationFn: (body: Record<string, string | undefined>) =>
      postJson<{ contract: { id: string } }>(`/api/contracts/${contractId}/renew`, body),
    onSuccess: async (result) => {
      await done();
      router.push(`/contracts/${result.contract.id}`);
    },
    onError: (e) => setError(message(e)),
  });

  const terminate = useMutation({
    mutationFn: (body: { reason: string }) =>
      postJson(`/api/contracts/${contractId}/terminate`, body),
    onSuccess: done,
    onError: (e) => setError(message(e)),
  });

  const pending = renew.isPending || terminate.isPending;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => {
            setError(null);
            setOpen(open === "renew" ? null : "renew");
          }}
          disabled={pending}
        >
          Rinovo
        </Button>
        <Button
          type="button"
          className="bg-[var(--surface)] text-[var(--danger)] ring-1 ring-[var(--border)]"
          onClick={() => {
            setError(null);
            setOpen(open === "terminate" ? null : "terminate");
          }}
          disabled={pending}
        >
          Ndërpre
        </Button>
      </div>

      {open === "renew" && (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            renew.mutate({
              startDate: String(form.get("startDate") ?? ""),
              endDate: String(form.get("endDate") ?? "") || undefined,
              commissionPercentage: String(form.get("commissionPercentage") ?? "") || undefined,
            });
          }}
        >
          <div>
            <Label htmlFor="startDate">Fillimi i kontratës së re</Label>
            <Input id="startDate" name="startDate" type="date" required />
          </div>
          <div>
            <Label htmlFor="endDate">Mbarimi (opsional)</Label>
            <Input id="endDate" name="endDate" type="date" />
          </div>
          <div>
            <Label htmlFor="commissionPercentage">Komisioni % (bosh = i njëjti)</Label>
            <Input
              id="commissionPercentage"
              name="commissionPercentage"
              inputMode="decimal"
              placeholder="p.sh. 7.50"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={pending}>
              {renew.isPending ? "Duke rinovuar…" : "Konfirmo rinovimin"}
            </Button>
          </div>
          <p className="text-sm text-[var(--muted)] sm:col-span-2">
            Kontrata aktuale mbyllet si RENEWED dhe e reja lidhet me të.
          </p>
        </form>
      )}

      {open === "terminate" && (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            terminate.mutate({ reason: String(form.get("reason") ?? "") });
          }}
        >
          <div>
            <Label htmlFor="reason">Arsyeja (detyrueshme)</Label>
            <Input id="reason" name="reason" required minLength={5} maxLength={500} />
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {terminate.isPending ? "Duke ndërprerë…" : "Konfirmo ndërprerjen"}
            </Button>
          </div>
          <p className="text-sm text-[var(--muted)]">
            Arsyeja ruhet në audit; ndërprerja është përfundimtare.
          </p>
        </form>
      )}

      <FieldError>{error}</FieldError>
    </div>
  );
}
