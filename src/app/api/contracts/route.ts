import { NextResponse } from "next/server";
import { withAuth, validationError } from "@/lib/auth/guards";
import { clientIp } from "@/lib/audit/request-context";
import { searchParamsToObject } from "@/lib/validation/list-query";
import {
  CreateContractSchema,
  ExportContractsQuerySchema,
  ListContractsQuerySchema,
} from "@/lib/validation/contracts";
import {
  CONTRACT_REPORT_COLUMNS,
  createContract,
  exportContracts,
  listContracts,
} from "@/lib/queries/contracts";
import { generatedAt, reportResponse } from "@/lib/export/reports";

export const runtime = "nodejs";

/**
 * The list, and — with `format` — the contract expiry report of section 8. Both
 * read the same rows through the same service and the same ownership predicate;
 * `expiringBefore` is the only thing the report adds.
 */
export const GET = withAuth("viewAll", "contract", async (request, { actor }) => {
  const params = searchParamsToObject(new URL(request.url));

  if (params.format) {
    const parsed = ExportContractsQuerySchema.safeParse(params);
    if (!parsed.success) return validationError(parsed.error.issues);

    const { rows, truncated } = await exportContracts(actor, parsed.data);
    const until = parsed.data.expiringBefore ?? "pa-afat";

    return reportResponse(
      {
        filename: `kontrata-${until}`,
        title: "Kontratat që skadojnë",
        subtitle: parsed.data.expiringBefore
          ? `Deri më ${parsed.data.expiringBefore} · gjeneruar më ${generatedAt()}`
          : `Të gjitha kontratat · gjeneruar më ${generatedAt()}`,
        columns: CONTRACT_REPORT_COLUMNS,
        rows,
        footer: `Gjithsej: ${rows.length} kontrata`,
        emptyMessage: "Asnjë kontratë nuk skadon në këtë interval.",
        headers: truncated ? { "x-export-truncated": "true" } : undefined,
      },
      parsed.data.format,
    );
  }

  const parsed = ListContractsQuerySchema.safeParse(params);
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(await listContracts(actor, parsed.data));
});

export const POST = withAuth("create", "contract", async (request, { actor }) => {
  const parsed = CreateContractSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(
    await createContract(actor, parsed.data, { ip: clientIp(request) }),
    { status: 201 },
  );
});
