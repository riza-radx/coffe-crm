"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreateClientSchema, type CreateClientInput, type CreateClientForm } from "@/lib/validation/clients";
import { postJson } from "@/lib/api/fetch-json";
import { clientKeys } from "@/lib/query/keys";
import type { ClientRow } from "@/lib/queries/clients";
import { Button, FieldError, Input, Label, Select } from "@/components/ui/field";

const TYPES = ["BAR", "RESTAURANT", "HOTEL", "HOME", "OFFICE", "OTHER"] as const;
const STATUSES = ["LEAD", "ACTIVE", "INACTIVE", "LOST"] as const;

export function ClientForm() {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateClientForm, unknown, CreateClientInput>({
    resolver: zodResolver(CreateClientSchema),
    defaultValues: { type: "BAR", status: "LEAD" },
  });

  const mutation = useMutation({
    mutationFn: (values: CreateClientInput) => postJson<ClientRow>("/api/clients", values),
    onSuccess: async (client) => {
      setCreated(client.name);
      reset({ type: "BAR", status: "LEAD" });
      await queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="grid gap-4 sm:grid-cols-2"
      noValidate
    >
      <div>
        <Label htmlFor="name">Emri</Label>
        <Input id="name" {...register("name")} />
        <FieldError>{errors.name?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="type">Tipi</Label>
        <Select id="type" {...register("type")}>
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
        <FieldError>{errors.type?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="city">Qyteti</Label>
        <Input id="city" {...register("city")} />
      </div>
      <div>
        <Label htmlFor="address">Adresa</Label>
        <Input id="address" {...register("address")} />
      </div>
      <div>
        <Label htmlFor="contactName">Personi i kontaktit</Label>
        <Input id="contactName" {...register("contactName")} />
      </div>
      <div>
        <Label htmlFor="contactPhone">Telefoni</Label>
        <Input id="contactPhone" {...register("contactPhone")} />
      </div>
      <div>
        <Label htmlFor="contactEmail">Email</Label>
        <Input id="contactEmail" type="email" {...register("contactEmail")} />
        <FieldError>{errors.contactEmail?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="taxId">NIPT</Label>
        <Input id="taxId" {...register("taxId")} />
      </div>
      <div>
        <Label htmlFor="status">Statusi</Label>
        <Select id="status" {...register("status")}>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-end gap-3 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Duke ruajtur…" : "Shto klientin"}
        </Button>
        {mutation.isError && <FieldError>Klienti nuk u krijua dot.</FieldError>}
        {created && !mutation.isError && (
          <p className="text-sm text-[var(--muted)]">{created} u shtua.</p>
        )}
      </div>
    </form>
  );
}
