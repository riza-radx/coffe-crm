"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CreateInviteSchema, type CreateInviteInput } from "@/lib/validation/auth";
import { Button, FieldError, Input, Label, Select } from "@/components/ui/field";

export function InviteForm() {
  const router = useRouter();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateInviteInput>({
    resolver: zodResolver(CreateInviteSchema),
    defaultValues: { role: "SALES" },
  });

  async function onSubmit(values: CreateInviteInput) {
    setFormError(null);
    setInviteUrl(null);
    const response = await fetch("/api/auth/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      inviteUrl?: string;
    };
    if (!response.ok) {
      setFormError(
        payload.error === "EMAIL_ALREADY_EXISTS"
          ? "Ky email ekziston tashmë."
          : "Ftesa nuk u krijua dot.",
      );
      return;
    }
    setInviteUrl(payload.inviteUrl ?? null);
    reset({ email: "", name: "", role: "SALES" });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="name">Emri</Label>
        <Input id="name" {...register("name")} />
        <FieldError>{errors.name?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register("email")} />
        <FieldError>{errors.email?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="role">Roli</Label>
        <Select id="role" {...register("role")}>
          <option value="SALES">Sales (internal)</option>
          <option value="OUTSIDE_SALES">Outside Sales</option>
          <option value="SUPER_ADMIN">Super Admin</option>
        </Select>
        <FieldError>{errors.role?.message}</FieldError>
      </div>
      <FieldError>{formError}</FieldError>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Duke dërguar…" : "Krijo ftesën"}
      </Button>
      {inviteUrl && (
        <p className="text-sm text-[var(--muted)]">
          Linku i ftesës (dërgimi me email vjen në Fazën 5):{" "}
          <code className="break-all">{inviteUrl}</code>
        </p>
      )}
    </form>
  );
}
