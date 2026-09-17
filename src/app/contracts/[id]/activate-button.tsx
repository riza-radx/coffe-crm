"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchJson, ApiRequestError } from "@/lib/api/fetch-json";
import { contractKeys } from "@/lib/query/keys";
import type { ContractRow } from "@/lib/queries/contracts";
import { Button, FieldError } from "@/components/ui/field";

const ERRORS: Record<string, string> = {
  TRANSITION_SAME_STATUS: "Kontrata është tashmë në këtë status.",
  TRANSITION_INVALID_TRANSITION: "Kalimi nuk lejohet nga statusi aktual.",
  TRANSITION_WRONG_CHANNEL: "Ky kalim bëhet nga veprimi i vet (rinovo ose ndërpre).",
};

/** The only transition Phase 2 exposes: DRAFT → ACTIVE. */
export function ActivateButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => patchJson<ContractRow>(`/api/contracts/${contractId}`, { status: "ACTIVE" }),
    onSuccess: async () => {
      setMessage(null);
      await queryClient.invalidateQueries({ queryKey: contractKeys.all });
      router.refresh();
    },
    onError: (error) => {
      setMessage(
        error instanceof ApiRequestError
          ? (ERRORS[error.code] ?? "Kontrata nuk u aktivizua dot.")
          : "Kontrata nuk u aktivizua dot.",
      );
    },
  });

  return (
    <div className="flex items-center gap-3">
      <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? "Duke aktivizuar…" : "Aktivizo kontratën"}
      </Button>
      <FieldError>{message}</FieldError>
    </div>
  );
}
