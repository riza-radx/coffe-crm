import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { Actor, Role } from "@/lib/rbac/types";

export class UnauthorizedError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export const getSession = cache(async () => auth());

/**
 * Revocation, tier B (never throttled).
 *
 * The only sanctioned way to learn who the caller is. Re-reads status and role
 * by primary key on every real request, so a SUSPENDED user loses access at once
 * and a role change takes effect without a new sign-in. React's cache() keeps it
 * to one lookup per render pass.
 */
export const requireUser = cache(async (): Promise<Actor & { email: string; name: string }> => {
  const session = await getSession();
  if (!session?.user?.id) throw new UnauthorizedError();

  const fresh = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
  if (!fresh || fresh.status !== "ACTIVE") throw new UnauthorizedError("Account is not active");

  return { id: fresh.id, email: fresh.email, name: fresh.name, role: fresh.role as Role };
});

/** Same, but returns null instead of throwing — for pages that render both states. */
export async function currentUser() {
  try {
    return await requireUser();
  } catch {
    return null;
  }
}
