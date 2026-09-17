import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/db";
import { config } from "@/lib/env";
import { verifyPassword } from "@/lib/password";
import { LoginSchema } from "@/lib/validation/auth";
import type { Role } from "@/lib/rbac/types";

const nowSeconds = () => Math.floor(Date.now() / 1000);

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = LoginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            passwordHash: true,
          },
        });

        // verifyPassword still runs a comparison when the hash is missing, so an
        // unknown email and a wrong password take the same time.
        const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? null);
        if (!user || !ok) return null;
        // INVITED (no password set yet) and SUSPENDED can never sign in.
        if (user.status !== "ACTIVE") return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return { id: user.id, email: user.email, name: user.name, role: user.role as Role };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    /**
     * Revocation, tier A (throttled).
     *
     * There is no session table in Phase 1, so users.status IS the session store.
     * Returning null here drops the token, which is the documented kill switch.
     * The check is throttled to SESSION_REVALIDATE_SECONDS because this callback
     * also runs for prefetches; anything that reads or writes data additionally
     * goes through requireUser() in the DAL, which never throttles.
     *
     * Note: when this returns null during a Server Component render Next cannot
     * clear the cookie, so the stale cookie survives until the next response that
     * can set cookies. Access is denied immediately either way.
     */
    async jwt({ token, user, trigger }) {
      if (user) {
        token.uid = user.id as string;
        token.role = user.role;
        token.chk = nowSeconds();
        return token;
      }
      if (!token.uid) return null;

      const age = nowSeconds() - (token.chk ?? 0);
      if (trigger !== "update" && age < config.sessionRevalidateSeconds) return token;

      const fresh = await prisma.user.findUnique({
        where: { id: token.uid },
        select: { status: true, role: true },
      });
      if (!fresh || fresh.status !== "ACTIVE") return null;

      token.role = fresh.role as Role;
      token.chk = nowSeconds();
      return token;
    },

    session({ session, token }) {
      if (token.uid) session.user.id = token.uid;
      if (token.role) session.user.role = token.role;
      return session;
    },
  },
});
