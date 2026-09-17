import { z } from "zod";
import { CUID, OptionalText } from "./common";
import { paginationSchema, sortParamSchema } from "./list-query";

export const ClientTypeSchema = z.enum(["BAR", "RESTAURANT", "HOTEL", "HOME", "OFFICE", "OTHER"]);
export const ClientStatusSchema = z.enum(["LEAD", "ACTIVE", "INACTIVE", "LOST"]);

export const CLIENT_SORTABLE = ["name", "city", "status", "createdAt"] as const;

export const ListClientsQuerySchema = paginationSchema.extend({
  search: OptionalText(120),
  type: ClientTypeSchema.optional(),
  city: OptionalText(120),
  salesOwner: CUID.optional(),
  status: ClientStatusSchema.optional(),
  sort: sortParamSchema(CLIENT_SORTABLE, "createdAt:desc"),
});

export const CreateClientSchema = z.object({
  name: z.string().trim().min(2, { error: "Emri duhet të paktën 2 shkronja" }).max(200),
  type: ClientTypeSchema,
  address: OptionalText(300),
  city: OptionalText(120),
  contactName: OptionalText(200),
  contactPhone: OptionalText(60),
  contactEmail: z.union([z.literal(""), z.email({ error: "Email i pavlefshëm" })]).optional(),
  taxId: OptionalText(60),
  status: ClientStatusSchema.default("LEAD"),
  /** Super Admin only; for a rep the server always forces their own id. */
  acquiredById: CUID.optional(),
});

export const UpdateClientSchema = CreateClientSchema.partial();

export type ListClientsQuery = z.infer<typeof ListClientsQuerySchema>;
/** What the form holds (before defaults/transforms). */
export type CreateClientForm = z.input<typeof CreateClientSchema>;
/** What the server receives. */
export type CreateClientInput = z.output<typeof CreateClientSchema>;
export type UpdateClientInput = z.output<typeof UpdateClientSchema>;
