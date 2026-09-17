import { NextResponse } from "next/server";
import { withAuth, type IdParams } from "@/lib/auth/guards";
import { markNotificationRead } from "@/lib/queries/notifications";

export const runtime = "nodejs";

export const PATCH = withAuth<IdParams>("view", "notification", async (_request, { actor, ctx }) => {
  const { id } = await ctx.params;
  return NextResponse.json(await markNotificationRead(actor, id));
});
