import { NextResponse } from "next/server";
import { withAuth, type IdParams } from "@/lib/auth/guards";
import { clientIp } from "@/lib/audit/request-context";
import { verifyBill } from "@/lib/queries/bills";

export const runtime = "nodejs";

/** Verification is what snapshots the commission — see lib/queries/bills.ts. */
export const POST = withAuth<IdParams>("verify", "bill", async (request, { actor, ctx }) => {
  const { id } = await ctx.params;
  return NextResponse.json(await verifyBill(actor, id, { ip: clientIp(request) }));
});
