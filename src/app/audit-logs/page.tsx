import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { can } from "@/lib/rbac";
import { AuditLogsTable } from "./audit-logs-table";

export default async function AuditLogsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  // "View audit logs — Yes / No / No". The proxy already gates the path by role;
  // this is the check that does not depend on a cookie being read correctly.
  if (!can(user, "view", "auditLog")) notFound();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Gjurmët e auditit</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Vetëm për lexim. Çdo rresht shkruhet brenda transaksionit të ndryshimit që përshkruan,
        ndaj një mutacion i refuzuar nuk lë gjurmë dhe një gjurmë nuk redaktohet dot.
      </p>

      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-[var(--muted)]">Duke ngarkuar…</p>}>
          <AuditLogsTable />
        </Suspense>
      </div>
    </main>
  );
}
