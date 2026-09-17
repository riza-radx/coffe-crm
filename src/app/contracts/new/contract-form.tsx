"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateContractSchema, type CreateContractInput, type CreateContractForm } from "@/lib/validation/contracts";
import { fetchJson, postJson } from "@/lib/api/fetch-json";
import { clientKeys, contractKeys } from "@/lib/query/keys";
import type { ClientRow } from "@/lib/queries/clients";
import type { ContractRow } from "@/lib/queries/contracts";
import type { Paginated } from "@/lib/validation/list-query";
import { Button, FieldError, Input, Label, Select } from "@/components/ui/field";

export function ContractForm() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const clients = useQuery({
    queryKey: clientKeys.list({ page: 1, pageSize: 100, sort: "name:asc" }),
    queryFn: () =>
      fetchJson<Paginated<ClientRow>>("/api/clients?page=1&pageSize=100&sort=name:asc"),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateContractForm, unknown, CreateContractInput>({ resolver: zodResolver(CreateContractSchema) });

  const mutation = useMutation({
    mutationFn: (values: CreateContractInput) => postJson<ContractRow>("/api/contracts", values),
    onSuccess: async (contract) => {
      await queryClient.invalidateQueries({ queryKey: contractKeys.lists() });
      router.push(`/contracts/${contract.id}`);
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="grid gap-4 sm:grid-cols-2"
      noValidate
    >
      <div className="sm:col-span-2">
        <Label htmlFor="clientId">Klienti</Label>
        <Select id="clientId" {...register("clientId")} defaultValue="">
          <option value="" disabled>
            {clients.isPending ? "Duke ngarkuar…" : "Zgjidh klientin"}
          </option>
          {clients.data?.data.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name} {client.city ? `· ${client.city}` : ""}
            </option>
          ))}
        </Select>
        <FieldError>{errors.clientId?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="commissionPercentage">Komisioni (%)</Label>
        <Input
          id="commissionPercentage"
          inputMode="decimal"
          placeholder="7.50"
          {...register("commissionPercentage")}
        />
        <FieldError>{errors.commissionPercentage?.message}</FieldError>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Ngrihet në krijim; vetëm Super Admin mund ta ndryshojë më pas.
        </p>
      </div>
      <div>
        <Label htmlFor="startDate">Data e fillimit</Label>
        <Input id="startDate" type="date" {...register("startDate")} />
        <FieldError>{errors.startDate?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="endDate">Data e mbarimit (opsionale)</Label>
        <Input id="endDate" type="date" {...register("endDate")} />
        <FieldError>{errors.endDate?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="paymentTerms">Kushtet e pagesës</Label>
        <Input id="paymentTerms" {...register("paymentTerms")} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="notes">Shënime</Label>
        <Input id="notes" {...register("notes")} />
      </div>
      <div className="flex items-end gap-3 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Duke ruajtur…" : "Krijo kontratën (DRAFT)"}
        </Button>
        {mutation.isError && <FieldError>Kontrata nuk u krijua dot.</FieldError>}
      </div>
    </form>
  );
}
