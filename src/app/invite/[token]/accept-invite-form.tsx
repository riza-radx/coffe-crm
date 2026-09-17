"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AcceptInviteSchema, type AcceptInviteInput } from "@/lib/validation/auth";
import { Button, FieldError, Input, Label } from "@/components/ui/field";

const ERRORS: Record<string, string> = {
  INVITE_NOT_FOUND: "Kjo ftesë nuk ekziston.",
  INVITE_EXPIRED: "Kjo ftesë ka skaduar.",
  INVITE_ALREADY_USED: "Kjo ftesë është përdorur tashmë.",
};

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInviteInput>({
    resolver: zodResolver(AcceptInviteSchema),
    defaultValues: { token },
  });

  async function onSubmit(values: AcceptInviteInput) {
    setFormError(null);
    const response = await fetch("/api/auth/accept-invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setFormError(ERRORS[payload.error ?? ""] ?? "Diçka shkoi keq. Provo përsëri.");
      return;
    }
    router.push("/login");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <input type="hidden" {...register("token")} />
      <div>
        <Label htmlFor="password">Fjalëkalimi i ri</Label>
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
        <FieldError>{errors.password?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="confirmPassword">Përsërit fjalëkalimin</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          {...register("confirmPassword")}
        />
        <FieldError>{errors.confirmPassword?.message}</FieldError>
      </div>
      <FieldError>{formError}</FieldError>
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Duke aktivizuar…" : "Aktivizo llogarinë"}
      </Button>
    </form>
  );
}
