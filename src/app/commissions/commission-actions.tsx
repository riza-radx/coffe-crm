"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postJson, ApiRequestError } from "@/lib/api/fetch-json";
import { billKeys, commissionKeys } from "@/lib/query/keys";
import type { CommissionRow } from "@/lib/queries/commissions";
import { Button, FieldError } from "@/components/ui/field";

const ERRORS: Record<string, string> = {
  TRANSITION_SAME_STATUS: "Komisioni është tashmë në këtë status.",
  TRANSITION_INVALID_TRANSITION: "Pagesa kërkon fillimisht aprovimin.",
  BILL_NOT_VERIFIED: "Fatura nuk është më e verifikuar.",
  COMMISSION_CONCURRENT_MODIFICATION: "Komisioni ndryshoi ndërkohë. Rifresko dhe provo sërish.",
  COMMISSION_NOT_FOUND: "Komisioni nuk u gjet.",
};

/** PENDING → APPROVED → PAID, one button at a time. */
export function CommissionActions({ commission }: { commission: CommissionRow }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (action: "approve" | "pay") =>
      postJson<CommissionRow>(`/api/commissions/${commission.id}/${action}`, {}),
    onSuccess: async () => {
      setMessage(null);
      await queryClient.invalidateQueries({ queryKey: commissionKeys.all });
      await queryClient.invalidateQueries({ queryKey: billKeys.all });
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

  if (commission.status === "PAID") {
    return <span className="text-sm text-[var(--muted)]">Paguar {commission.paidAt ?? ""}</span>;
  }

  const action = commission.status === "PENDING" ? "approve" : "pay";

  return (
    <div className="whitespace-nowrap">
      <Button
        type="button"
        className="px-3 py-1"
        onClick={() => mutation.mutate(action)}
        disabled={mutation.isPending}
      >
        {action === "approve" ? "Aprovo" : "Shëno si paguar"}
      </Button>
      <FieldError>{message}</FieldError>
    </div>
  );
}
