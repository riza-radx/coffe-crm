import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { can } from "@/lib/rbac";
import { Card } from "@/components/ui/field";
import { BillForm } from "./bill-form";

export default async function NewBillPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user, "create", "bill")) redirect("/bills");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/bills" className="text-sm text-[var(--muted)] underline-offset-2 hover:underline">
        ← Faturat
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Faturë e re</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Fatura krijohet si PENDING. Verifikimi dhe komisioni vijnë në Fazën 3.
      </p>
      <Card className="mt-6">
        <BillForm />
      </Card>
    </main>
  );
}
