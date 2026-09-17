import { NextResponse } from "next/server";
import { withAuth, type IdParams } from "@/lib/auth/guards";
import { clientIp } from "@/lib/audit/request-context";
import { approveCommission } from "@/lib/queries/commissions";

export const runtime = "nodejs";

export const POST = withAuth<IdParams>("approve", "commission", async (request, { actor, ctx }) => {
  const { id } = await ctx.params;
  return NextResponse.json(await approveCommission(actor, id, { ip: clientIp(request) }));
});
