import { NextResponse } from "next/server";
import { withAuth, validationError, type IdParams } from "@/lib/auth/guards";
import { clientIp } from "@/lib/audit/request-context";
import { RenewContractSchema } from "@/lib/validation/contracts";
import { renewContract } from "@/lib/queries/contracts";

export const runtime = "nodejs";

export const POST = withAuth<IdParams>("renew", "contract", async (request, { actor, ctx }) => {
  const { id } = await ctx.params;
  const parsed = RenewContractSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  const result = await renewContract(actor, id, parsed.data, { ip: clientIp(request) });
  return NextResponse.json(result, { status: 201 });
});
