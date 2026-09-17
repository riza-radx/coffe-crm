import { NextResponse } from "next/server";
import { withAuth, validationError, type IdParams } from "@/lib/auth/guards";
import { clientIp } from "@/lib/audit/request-context";
import { UpdateBillSchema } from "@/lib/validation/bills";
import { getBill, updateBill } from "@/lib/queries/bills";

export const runtime = "nodejs";

export const GET = withAuth<IdParams>("viewAll", "contract", async (_request, { actor, ctx }) => {
  const { id } = await ctx.params;
  return NextResponse.json(await getBill(actor, id));
});

/**
 * Corrections before verification. Guarded by "Add bill", which is own-scoped for
 * both rep roles — a rep may fix a typo on their own pending bill even when they
 * may not verify it. The service refuses anything past PENDING.
 */
export const PATCH = withAuth<IdParams>("create", "bill", async (request, { actor, ctx }) => {
  const { id } = await ctx.params;
  const parsed = UpdateBillSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(await updateBill(actor, id, parsed.data, { ip: clientIp(request) }));
});
