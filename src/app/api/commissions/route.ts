import { NextResponse } from "next/server";
import { withAuth, validationError } from "@/lib/auth/guards";
import { searchParamsToObject } from "@/lib/validation/list-query";
import {
  ExportCommissionsQuerySchema,
  ListCommissionsQuerySchema,
} from "@/lib/validation/commissions";
import {
  COMMISSION_REPORT_COLUMNS,
  exportCommissions,
  listCommissions,
} from "@/lib/queries/commissions";
import { generatedAt, reportResponse } from "@/lib/export/reports";

export const runtime = "nodejs";

/**
 * Super Admin sees every payout; a rep sees their own, scoped in the query.
 *
 * `format=csv|pdf` returns the same rows as the commission statement of step 16 —
 * one handler, so an export can never show a row the list would have hidden.
 */
export const GET = withAuth("viewAll", "commission", async (request, { actor }) => {
  const params = searchParamsToObject(new URL(request.url));

  if (params.format) {
    const parsed = ExportCommissionsQuerySchema.safeParse(params);
    if (!parsed.success) return validationError(parsed.error.issues);

    const { rows, truncated, total } = await exportCommissions(actor, parsed.data);
    const period = parsed.data.period ?? "te-gjitha";

    return reportResponse(
      {
        filename: `komisione-${period}`,
        title: "Pasqyra e komisioneve",
        subtitle: `Periudha ${period} · gjeneruar më ${generatedAt()}`,
        columns: COMMISSION_REPORT_COLUMNS,
        rows,
        footer: `Gjithsej: ${rows.length} komisione · ${total}`,
        emptyMessage: "Asnjë komision për këta filtra.",
        // Honest about a cut-off file rather than letting a short statement pass
        // for a complete one.
        headers: truncated ? { "x-export-truncated": "true" } : undefined,
      },
      parsed.data.format,
    );
  }

  const parsed = ListCommissionsQuerySchema.safeParse(params);
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(await listCommissions(actor, parsed.data));
});
