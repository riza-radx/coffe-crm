import { NextResponse } from "next/server";
import { withAuth, validationError } from "@/lib/auth/guards";
import { searchParamsToObject } from "@/lib/validation/list-query";
import { LeaderboardQuerySchema } from "@/lib/validation/analytics";
import { getLeaderboard } from "@/lib/queries/analytics";

export const runtime = "nodejs";

/**
 * The guard decides *reachability*, not shape: every rep may see their own
 * standing, so the gate is `viewAll:commission` (allowed for all three roles),
 * not `viewFull:leaderboard` (which denies Outside Sales outright and would 403
 * them off their own numbers). Who sees the whole board is decided inside
 * `getLeaderboard`, by `viewFull:leaderboard`.
 */
export const GET = withAuth("viewAll", "commission", async (request, { actor }) => {
  const parsed = LeaderboardQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(await getLeaderboard(actor, parsed.data));
});
