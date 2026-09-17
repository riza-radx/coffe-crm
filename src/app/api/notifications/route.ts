import { NextResponse } from "next/server";
import { withAuth, validationError } from "@/lib/auth/guards";
import { searchParamsToObject } from "@/lib/validation/list-query";
import { ListNotificationsQuerySchema } from "@/lib/validation/notifications";
import { listNotifications } from "@/lib/queries/notifications";

export const runtime = "nodejs";

/** Every role reads its own feed; the scope is a WHERE clause, not a role check. */
export const GET = withAuth("view", "notification", async (request, { actor }) => {
  const parsed = ListNotificationsQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(await listNotifications(actor, parsed.data));
});
