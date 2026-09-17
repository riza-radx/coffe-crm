import { z } from "zod";
import { paginationSchema, sortParamSchema } from "./list-query";

export const NotificationTypeSchema = z.enum([
  "CONTRACT_EXPIRING",
  "CONTRACT_EXPIRED",
  "BILL_DISPUTED",
  "COMMISSION_APPROVED",
  "COMMISSION_PAID",
  "INVITE_ACCEPTED",
]);

export const NOTIFICATION_SORTABLE = ["createdAt"] as const;

/** The bell asks for "my unread"; the list page drops the filter. */
export const ListNotificationsQuerySchema = paginationSchema.extend({
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  type: NotificationTypeSchema.optional(),
  sort: sortParamSchema(NOTIFICATION_SORTABLE, "createdAt:desc"),
});

export const EmailDeliverySchema = z.enum(["OFF", "INSTANT", "DIGEST"]);

/**
 * A full replacement, not a patch: the settings form knows every type, and a
 * partial save is how a user ends up unable to explain why one email still
 * arrives. Each type may appear once.
 */
export const UpdatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        type: NotificationTypeSchema,
        inApp: z.boolean(),
        email: EmailDeliverySchema,
      }),
    )
    .min(1)
    .max(NotificationTypeSchema.options.length)
    .refine(
      (list) => new Set(list.map((item) => item.type)).size === list.length,
      { error: "Një tip njoftimi mund të jepet vetëm një herë" },
    ),
});

export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;
export type UpdatePreferencesInput = z.output<typeof UpdatePreferencesSchema>;
