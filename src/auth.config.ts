import type { NextAuthConfig } from "next-auth";
import { canAccessPath, isPublicPath } from "@/lib/rbac/routes";
import type { Role } from "@/lib/rbac/types";

/**
 * Prisma-free half of the Auth.js config. Imported by both auth.ts and proxy.ts
 * so the proxy bundle never pulls the database client in.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  session: {
    strategy: "jwt" as const,
    maxAge: 60 * 60 * 8,
    updateAge: 60 * 15,
  },
  trustHost: true,
  providers: [],
  callbacks: {
    /**
     * Cookie-only page gating. No database access here: the proxy runs on every
     * navigation including prefetches. Real authorization lives in route handlers
     * and server actions via can().
     */
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (isPublicPath(pathname)) return true;
      const role = (auth?.user?.role ?? null) as Role | null;
      if (!auth?.user) return false;
      return canAccessPath(role, pathname);
    },
  },
} satisfies NextAuthConfig;
