"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateBillSchema, type CreateBillInput, type CreateBillForm } from "@/lib/validation/bills";
import { ApiRequestError, fetchJson, postJson } from "@/lib/api/fetch-json";
import { billKeys, contractKeys } from "@/lib/query/keys";
import type { BillRow } from "@/lib/queries/bills";
import type { ContractRow } from "@/lib/queries/contracts";
import type { Paginated } from "@/lib/validation/list-query";
import { Button, FieldError, Input, Label, Select } from "@/components/ui/field";

const ERRORS: Record<string, string> = {
  CONTRACT_NOT_FOUND: "Kjo kontratë nuk është e dukshme për ty.",
  CONTRACT_NOT_ACTIVE: "Fatura mund t'i bashkëngjitet vetëm një kontrate ACTIVE.",
};

export function BillForm() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Only ACTIVE contracts can take bills, so the selector asks for exactly those.
  const contracts = useQuery({
    queryKey: contractKeys.list({ page: 1, pageSize: 100, status: "ACTIVE" }),
    queryFn: () =>
      fetchJson<Paginated<ContractRow>>(
        "/api/contracts?page=1&pageSize=100&status=ACTIVE&sort=startDate:desc",
      ),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateBillForm, unknown, CreateBillInput>({
    resolver: zodResolver(CreateBillSchema),
    defaultValues: { currency: "ALL" },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateBillInput) => postJson<BillRow>("/api/bills", values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: billKeys.lists() });
      router.push("/bills");
    },
  });

  const error =
    mutation.error instanceof ApiRequestError
      ? (ERRORS[mutation.error.code] ?? "Fatura nuk u krijua dot.")
      : mutation.isError
        ? "Fatura nuk u krijua dot."
        : null;

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="grid gap-4 sm:grid-cols-2"
      noValidate
    >
      <div className="sm:col-span-2">
        <Label htmlFor="contractId">Kontrata (vetëm ACTIVE)</Label>
        <Select id="contractId" {...register("contractId")} defaultValue="">
          <option value="" disabled>
            {contracts.isPending ? "Duke ngarkuar…" : "Zgjidh kontratën"}
          </option>
          {contracts.data?.data.map((contract) => (
            <option key={contract.id} value={contract.id}>
              {contract.client.name} · {contract.commissionPercentage}% · nga {contract.startDate}
            </option>
          ))}
        </Select>
        <FieldError>{errors.contractId?.message}</FieldError>
        {contracts.data?.data.length === 0 && (
          <p className="mt-1 text-xs text-[var(--muted)]">
            Asnjë kontratë ACTIVE. Aktivizo një kontratë para se të shtosh fatura.
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="billNumber">Numri i faturës</Label>
        <Input id="billNumber" {...register("billNumber")} />
        <FieldError>{errors.billNumber?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="billDate">Data</Label>
        <Input id="billDate" type="date" {...register("billDate")} />
        <FieldError>{errors.billDate?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="amount">Vlera</Label>
        <Input id="amount" inputMode="decimal" placeholder="120000.00" {...register("amount")} />
        <FieldError>{errors.amount?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="currency">Monedha</Label>
        <Input id="currency" maxLength={3} {...register("currency")} />
        <FieldError>{errors.currency?.message}</FieldError>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="attachmentUrl">Link i dokumentit (opsional)</Label>
        <Input id="attachmentUrl" {...register("attachmentUrl")} />
      </div>
      <div className="flex items-end gap-3 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Duke ruajtur…" : "Shto faturën"}
        </Button>
        <FieldError>{error}</FieldError>
      </div>
    </form>
  );
}
