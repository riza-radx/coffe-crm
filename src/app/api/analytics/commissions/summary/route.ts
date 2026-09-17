import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/guards";
import { getCommissionSummary } from "@/lib/queries/analytics";

export const runtime = "nodejs";

/** Totals by status, scoped exactly as GET /api/commissions is scoped. */
export const GET = withAuth("viewAll", "commission", async (_request, { actor }) =>
  NextResponse.json(await getCommissionSummary(actor)),
);
