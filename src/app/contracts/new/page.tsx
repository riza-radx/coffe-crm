import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { can } from "@/lib/rbac";
import { Card } from "@/components/ui/field";
import { ContractForm } from "./contract-form";

export default async function NewContractPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user, "create", "contract")) redirect("/contracts");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/contracts" className="text-sm text-[var(--muted)] underline-offset-2 hover:underline">
        ← Kontratat
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Kontratë e re</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Kontrata krijohet si DRAFT. Faturat mund t&apos;i bashkëngjitesh vetëm pasi kalon në ACTIVE.
      </p>
      <Card className="mt-6">
        <ContractForm />
      </Card>
    </main>
  );
}
