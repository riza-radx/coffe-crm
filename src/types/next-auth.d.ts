import type { Role } from "@/lib/rbac/types";

declare module "next-auth" {
  interface User {
    role: Role;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
    };
  }
}

// next-auth/jwt only re-exports @auth/core/jwt, so the JWT interface has to be
// augmented at its source for the extra claims to be visible in the callbacks.
declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
    /** unix seconds of the last database freshness check */
    chk?: number;
  }
}

export {};
