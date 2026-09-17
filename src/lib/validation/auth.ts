import { z } from "zod";

export const RoleSchema = z.enum(["SUPER_ADMIN", "SALES", "OUTSIDE_SALES"]);

export const LoginSchema = z.object({
  email: z.email({ error: "Email i pavlefshëm" }).trim().toLowerCase(),
  password: z.string().min(1, { error: "Fjalëkalimi është i detyrueshëm" }),
});

export const CreateInviteSchema = z.object({
  email: z.email({ error: "Email i pavlefshëm" }).trim().toLowerCase(),
  name: z.string().min(2, { error: "Emri duhet të ketë të paktën 2 shkronja" }).trim(),
  role: RoleSchema,
});

export const AcceptInviteSchema = z
  .object({
    token: z.string().min(16, { error: "Token i pavlefshëm" }),
    password: z.string().min(10, { error: "Fjalëkalimi duhet të ketë të paktën 10 karaktere" }),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    error: "Fjalëkalimet nuk përputhen",
    path: ["confirmPassword"],
  });

export const ListUsersQuerySchema = z.object({
  role: RoleSchema.optional(),
  status: z.enum(["ACTIVE", "INVITED", "SUSPENDED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type LoginForm = z.input<typeof LoginSchema>;
export type LoginInput = z.output<typeof LoginSchema>;
export type CreateInviteForm = z.input<typeof CreateInviteSchema>;
export type CreateInviteInput = z.output<typeof CreateInviteSchema>;
export type AcceptInviteForm = z.input<typeof AcceptInviteSchema>;
export type AcceptInviteInput = z.output<typeof AcceptInviteSchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
