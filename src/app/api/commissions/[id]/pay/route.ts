import { NextResponse } from "next/server";
import { withAuth, type IdParams } from "@/lib/auth/guards";
import { clientIp } from "@/lib/audit/request-context";
import { payCommission } from "@/lib/queries/commissions";

export const runtime = "nodejs";

export const POST = withAuth<IdParams>("pay", "commission", async (request, { actor, ctx }) => {
  const { id } = await ctx.params;
  return NextResponse.json(await payCommission(actor, id, { ip: clientIp(request) }));
});
