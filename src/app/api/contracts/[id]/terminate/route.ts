import { NextResponse } from "next/server";
import { withAuth, validationError, type IdParams } from "@/lib/auth/guards";
import { clientIp } from "@/lib/audit/request-context";
import { TerminateContractSchema } from "@/lib/validation/contracts";
import { terminateContract } from "@/lib/queries/contracts";

export const runtime = "nodejs";

export const POST = withAuth<IdParams>("terminate", "contract", async (request, { actor, ctx }) => {
  const { id } = await ctx.params;
  const parsed = TerminateContractSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(
    await terminateContract(actor, id, parsed.data, { ip: clientIp(request) }),
  );
});
