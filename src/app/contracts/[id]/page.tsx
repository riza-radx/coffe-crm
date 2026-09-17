import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { getContract } from "@/lib/queries/contracts";
import { ApiError } from "@/lib/api/errors";
import { formatDecimal } from "@/lib/api/decimal";
import { Card } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { can } from "@/lib/rbac";
import { ActivateButton } from "./activate-button";
import { LifecycleActions } from "./lifecycle-actions";

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const contract = await getContract(user, id).catch((error) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });

  // "Terminate/renew contract — Yes / Yes (own, with limits) / No". The page only
  // hides the buttons; both endpoints re-check the role and the ownership.
  const canRenew = can(user, "renew", "contract");
  const canTerminate = can(user, "terminate", "contract");

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/contracts" className="text-sm text-[var(--muted)] underline-offset-2 hover:underline">
        ← Kontratat
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">
        <Link href={`/clients/${contract.client.id}`} className="underline-offset-2 hover:underline">
          {contract.client.name}
        </Link>
      </h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {contract.startDate} → {contract.endDate ?? "e hapur"} · përfaqësuesi {contract.salesOwner.name}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-[var(--muted)]">Statusi</p>
          <p className="mt-2">
            <StatusBadge value={contract.status} />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--muted)]">Komisioni</p>
          <p className="mt-2 text-xl font-semibold">{contract.commissionPercentage}%</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--muted)]">Faturuar (pa VOID)</p>
          <p className="mt-2 text-xl font-semibold">{formatDecimal(contract.totals.billedAmount)}</p>
        </Card>
      </div>

      {contract.status === "DRAFT" && (
        <Card className="mt-6">
          <h2 className="mb-1 text-sm font-medium">Kalimi DRAFT → ACTIVE</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Derisa kontrata është DRAFT, faturat nuk mund t&apos;i bashkëngjiten.
          </p>
          <ActivateButton contractId={contract.id} />
        </Card>
      )}

      {contract.status === "ACTIVE" && (canRenew || canTerminate) && (
        <Card className="mt-6">
          <h2 className="mb-1 text-sm font-medium">Cikli i kontratës</h2>
          <p className="mb-4 text-sm text-[var(--muted)]">
            Rinovimi mbyll këtë kontratë dhe hap pasardhësen e lidhur me të; ndërprerja kërkon
            një arsye. Skadimi bëhet vetë nga puna e natës kur kalon data e mbarimit.
          </p>
          <LifecycleActions contractId={contract.id} />
        </Card>
      )}

      {contract.previousContractId && (
        <p className="mt-4 text-sm text-[var(--muted)]">
          Rinovim i{" "}
          <Link
            href={`/contracts/${contract.previousContractId}`}
            className="underline-offset-2 hover:underline"
          >
            kontratës së mëparshme
          </Link>
          .
        </p>
      )}

      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-medium">Detajet</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Kushtet e pagesës</dt>
            <dd>{contract.paymentTerms ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Dokumenti i nënshkruar</dt>
            <dd>{contract.signedDocumentUrl ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--muted)]">Shënime</dt>
            <dd>{contract.notes ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <Card className="mt-6 overflow-x-auto">
        <h2 className="mb-3 text-sm font-medium">Faturat ({contract.totals.billCount})</h2>
        {contract.bills.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Asnjë faturë.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="pb-2">Numri</th>
                <th className="pb-2">Data</th>
                <th className="pb-2">Vlera</th>
                <th className="pb-2">Statusi</th>
              </tr>
            </thead>
            <tbody>
              {contract.bills.map((bill) => (
                <tr key={bill.id} className="border-t border-[var(--border)]">
                  <td className="py-2">{bill.billNumber}</td>
                  <td className="py-2">{bill.billDate}</td>
                  <td className="py-2">
                    {formatDecimal(bill.amount)} {bill.currency}
                  </td>
                  <td className="py-2">
                    <StatusBadge value={bill.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}
