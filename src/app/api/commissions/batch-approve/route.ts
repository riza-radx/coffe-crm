import { NextResponse } from "next/server";
import { withAuth, validationError } from "@/lib/auth/guards";
import { clientIp } from "@/lib/audit/request-context";
import { BatchApproveSchema } from "@/lib/validation/commissions";
import { batchApproveCommissions } from "@/lib/queries/commissions";

export const runtime = "nodejs";

/** Either the ids the caller ticked, or the list's own filters — never an empty body. */
export const POST = withAuth("approve", "commission", async (request, { actor }) => {
  const parsed = BatchApproveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(
    await batchApproveCommissions(actor, parsed.data, { ip: clientIp(request) }),
  );
});
