"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postJson, ApiRequestError } from "@/lib/api/fetch-json";
import { billKeys, commissionKeys } from "@/lib/query/keys";
import type { BillRow } from "@/lib/queries/bills";
import { Button, FieldError, Input, Label } from "@/components/ui/field";

const ERRORS: Record<string, string> = {
  TRANSITION_SAME_STATUS: "Fatura është tashmë në këtë status.",
  TRANSITION_INVALID_TRANSITION: "Kalimi nuk lejohet nga statusi aktual.",
  COMMISSION_ALREADY_EXISTS: "Kjo faturë ka tashmë një komision.",
  COMMISSION_LOCKED: "Komisioni është aprovuar ose paguar — fatura nuk kthehet më prapa.",
  BILL_CONCURRENT_MODIFICATION: "Fatura ndryshoi ndërkohë. Rifresko dhe provo sërish.",
  BILL_NOT_FOUND: "Fatura nuk u gjet.",
};

type Action = "verify" | "dispute" | "void";

const LABEL: Record<Action, string> = {
  verify: "Verifiko",
  dispute: "Kontesto",
  void: "Anulo",
};

/**
 * Verification is what creates the commission, so the buttons mirror the state
 * machine exactly. The server re-checks every one of these rules — this only
 * decides what is worth showing.
 */
export function BillActions({ bill, canVerify }: { bill: BillRow; canVerify: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: (action: Action) =>
      postJson<BillRow>(
        `/api/bills/${bill.id}/${action}`,
        action === "verify" ? {} : { reason: reason || undefined },
      ),
    onSuccess: async () => {
      setMessage(null);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: billKeys.all });
      await queryClient.invalidateQueries({ queryKey: commissionKeys.all });
      router.refresh();
    },
    onError: (error) => {
      setMessage(
        error instanceof ApiRequestError
          ? (ERRORS[error.code] ?? "Veprimi nuk u krye dot.")
          : "Veprimi nuk u krye dot.",
      );
    },
  });

  if (!canVerify) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Verifikimi i faturave i takon Super Admin-it dhe përfaqësuesit të kontratës.
      </p>
    );
  }

  const locked = bill.commission !== null && bill.commission.status !== "PENDING";
  const available: Action[] =
    bill.status === "PENDING"
      ? ["verify", "dispute", "void"]
      : bill.status === "VERIFIED"
        ? ["dispute", "void"]
        : bill.status === "DISPUTED"
          ? ["verify", "void"]
          : [];

  if (available.length === 0) {
    return <p className="text-sm text-[var(--muted)]">Fatura është anuluar — s&apos;ka veprime.</p>;
  }

  return (
    <div className="space-y-3">
      {available.some((action) => action !== "verify") && (
        <div className="max-w-sm">
          <Label htmlFor="reason">Arsyeja (ruhet në audit)</Label>
          <Input
            id="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Pse kontestohet ose anulohet"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {available.map((action) => (
          <Button
            key={action}
            type="button"
            onClick={() => mutation.mutate(action)}
            disabled={mutation.isPending || (locked && action !== "verify")}
          >
            {LABEL[action]}
          </Button>
        ))}
      </div>

      {locked && (
        <p className="text-sm text-[var(--muted)]">
          Komisioni është {bill.commission?.status} — kontestimi dhe anulimi janë të bllokuara.
        </p>
      )}
      <FieldError>{message}</FieldError>
    </div>
  );
}
