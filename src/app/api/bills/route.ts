import { NextResponse } from "next/server";
import { withAuth, validationError } from "@/lib/auth/guards";
import { searchParamsToObject } from "@/lib/validation/list-query";
import { CreateBillSchema, ListBillsQuerySchema } from "@/lib/validation/bills";
import { createBill, listBills } from "@/lib/queries/bills";

export const runtime = "nodejs";

// Bills inherit contract visibility — see the note in src/lib/queries/bills.ts.
export const GET = withAuth("viewAll", "contract", async (request, { actor }) => {
  const parsed = ListBillsQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(await listBills(actor, parsed.data));
});

export const POST = withAuth("create", "bill", async (request, { actor }) => {
  const parsed = CreateBillSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(await createBill(actor, parsed.data), { status: 201 });
});
