"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { LoginSchema, type LoginInput } from "@/lib/validation/auth";
import { Button, FieldError, Input, Label } from "@/components/ui/field";

export function LoginForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginSchema) });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    const result = await signIn("credentials", { ...values, redirect: false });
    if (!result || result.error) {
      setFormError("Email ose fjalëkalim i pasaktë, ose llogaria nuk është aktive.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        <FieldError>{errors.email?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="password">Fjalëkalimi</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register("password")}
        />
        <FieldError>{errors.password?.message}</FieldError>
      </div>
      <FieldError>{formError}</FieldError>
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Duke hyrë…" : "Hyr"}
      </Button>
    </form>
  );
}
