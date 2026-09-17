import { NextResponse } from "next/server";
import { withAuth, validationError } from "@/lib/auth/guards";
import { UpdatePreferencesSchema } from "@/lib/validation/notifications";
import {
  getNotificationPreferences,
  setNotificationPreferences,
} from "@/lib/queries/notifications";

export const runtime = "nodejs";

/**
 * Step 19. Preferences are personal, so both verbs act on the caller's own rows
 * and take no user id — there is no parameter here that could be pointed at
 * somebody else's settings.
 */
export const GET = withAuth("view", "notification", async (_request, { actor }) =>
  NextResponse.json({ preferences: await getNotificationPreferences(actor) }),
);

export const PUT = withAuth("view", "notification", async (request, { actor }) => {
  const parsed = UpdatePreferencesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json({ preferences: await setNotificationPreferences(actor, parsed.data) });
});
