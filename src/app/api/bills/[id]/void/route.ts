import { NextResponse } from "next/server";
import { withAuth, validationError, type IdParams } from "@/lib/auth/guards";
import { clientIp } from "@/lib/audit/request-context";
import { BillActionSchema } from "@/lib/validation/bills";
import { voidBill } from "@/lib/queries/bills";

export const runtime = "nodejs";

export const POST = withAuth<IdParams>("verify", "bill", async (request, { actor, ctx }) => {
  const { id } = await ctx.params;
  const parsed = BillActionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(
    await voidBill(actor, id, { ip: clientIp(request), reason: parsed.data.reason }),
  );
});
