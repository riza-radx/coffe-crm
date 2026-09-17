import { NextResponse } from "next/server";
import { withAuth, validationError, type IdParams } from "@/lib/auth/guards";
import { forbidden as forbiddenError } from "@/lib/api/errors";
import { clientIp } from "@/lib/audit/request-context";
import { UpdateClientSchema } from "@/lib/validation/clients";
import { getClient, updateClient } from "@/lib/queries/clients";

export const runtime = "nodejs";

export const GET = withAuth<IdParams>("viewAll", "client", async (_request, { actor, ctx }) => {
  const { id } = await ctx.params;
  return NextResponse.json(await getClient(actor, id));
});

/**
 * Editing is gated on the same permission as viewing, because the RBAC table has no
 * separate "edit client" row: the scope decides — "all" edits anyone's client,
 * "own" only their own (enforced in the query, not here).
 */
export const PATCH = withAuth<IdParams>("viewAll", "client", async (request, { actor, ctx }) => {
  const { id } = await ctx.params;
  const parsed = UpdateClientSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);

  // Moving a client to another rep changes acquisition credit. The plan does not
  // cover it, so it is kept to the role that owns the other attribution decisions.
  if (parsed.data.acquiredById !== undefined && actor.role !== "SUPER_ADMIN") {
    throw forbiddenError("REASSIGN_FORBIDDEN");
  }

  return NextResponse.json(await updateClient(actor, id, parsed.data, { ip: clientIp(request) }));
});
