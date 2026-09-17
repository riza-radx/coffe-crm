import { NextResponse } from "next/server";
import { withAuth, validationError, type IdParams } from "@/lib/auth/guards";
import { clientIp } from "@/lib/audit/request-context";
import { UpdateContractSchema } from "@/lib/validation/contracts";
import { getContract, updateContract } from "@/lib/queries/contracts";

export const runtime = "nodejs";

export const GET = withAuth<IdParams>("viewAll", "contract", async (_request, { actor, ctx }) => {
  const { id } = await ctx.params;
  return NextResponse.json(await getContract(actor, id));
});

/**
 * One PATCH covers field edits and the DRAFT→ACTIVE transition. Per-field
 * permissions (commission %, reassignment) and the state machine are enforced in
 * the service, so a crafted request cannot slip past a UI check.
 */
export const PATCH = withAuth<IdParams>("viewAll", "contract", async (request, { actor, ctx }) => {
  const { id } = await ctx.params;
  const parsed = UpdateContractSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(await updateContract(actor, id, parsed.data, { ip: clientIp(request) }));
});
