import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/guards";
import { ListUsersQuerySchema } from "@/lib/validation/auth";

export const runtime = "nodejs";

/** GET /api/users — Super Admin only, always paginated server-side. */
export const GET = withAuth("manage", "user", async (request) => {
  const url = new URL(request.url);
  const parsed = ListUsersQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { role, status, page, pageSize } = parsed.data;
  const where = { ...(role ? { role } : {}), ...(status ? { status } : {}) };

  const [total, data] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({ data, page, pageSize, total });
});
