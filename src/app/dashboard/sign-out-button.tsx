"use client";

import { signOut } from "next-auth/react";
import { clearQueryCache } from "@/lib/query/client";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        // List responses are RBAC-scoped, so the cache must not outlive the session.
        clearQueryCache();
        await signOut({ callbackUrl: "/login" });
      }}
      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
    >
      Dil
    </button>
  );
}
