import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { can } from "@/lib/rbac";
import { Card } from "@/components/ui/field";
import { ClientsTable } from "./clients-table";
import { ClientForm } from "./client-form";

export default async function ClientsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Klientët</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {can(user, "viewAll", "client")
          ? "Lista filtrohet dhe faqoset në server."
          : "Shihen vetëm klientët që ke sjellë ti."}
      </p>

      {can(user, "create", "client") && (
        <Card className="mt-6">
          <h2 className="mb-4 text-sm font-medium">Shto klient</h2>
          <ClientForm />
        </Card>
      )}

      <div className="mt-6">
        {/* useSearchParams suspends during a production build without this boundary. */}
        <Suspense fallback={<p className="text-sm text-[var(--muted)]">Duke ngarkuar…</p>}>
          <ClientsTable />
        </Suspense>
      </div>
    </main>
  );
}
