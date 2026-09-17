import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { can } from "@/lib/rbac";
import { ContractsTable } from "./contracts-table";

export default async function ContractsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Kontratat</h1>
        {can(user, "create", "contract") && (
          <Link
            href="/contracts/new"
            className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
          >
            Kontratë e re
          </Link>
        )}
      </div>

      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-[var(--muted)]">Duke ngarkuar…</p>}>
          <ContractsTable />
        </Suspense>
      </div>
    </main>
  );
}
