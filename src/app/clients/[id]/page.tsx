import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { getClient } from "@/lib/queries/clients";
import { ApiError } from "@/lib/api/errors";
import { formatDecimal } from "@/lib/api/decimal";
import { Card } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const client = await getClient(user, id).catch((error) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/clients" className="text-sm text-[var(--muted)] underline-offset-2 hover:underline">
        ← Klientët
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{client.name}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {client.type} · {client.city ?? "qytet i pacaktuar"} · sjellë nga {client.acquiredBy.name}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-[var(--muted)]">Statusi</p>
          <p className="mt-2">
            <StatusBadge value={client.status} />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--muted)]">Fatura</p>
          <p className="mt-2 text-xl font-semibold">{client.totals.billCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--muted)]">Faturuar (pa VOID)</p>
          <p className="mt-2 text-xl font-semibold">{formatDecimal(client.totals.billedAmount)}</p>
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-medium">Kontaktet</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Personi</dt>
            <dd>{client.contactName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Telefoni</dt>
            <dd>{client.contactPhone ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Email</dt>
            <dd>{client.contactEmail ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">NIPT</dt>
            <dd>{client.taxId ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--muted)]">Adresa</dt>
            <dd>{client.address ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <Card className="mt-6 overflow-x-auto">
        <h2 className="mb-3 text-sm font-medium">Kontratat</h2>
        {client.contracts.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Asnjë kontratë.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="pb-2">Periudha</th>
                <th className="pb-2">Komisioni</th>
                <th className="pb-2">Përfaqësuesi</th>
                <th className="pb-2">Statusi</th>
              </tr>
            </thead>
            <tbody>
              {client.contracts.map((contract) => (
                <tr key={contract.id} className="border-t border-[var(--border)]">
                  <td className="py-2">
                    <Link href={`/contracts/${contract.id}`} className="underline-offset-2 hover:underline">
                      {contract.startDate} → {contract.endDate ?? "e hapur"}
                    </Link>
                  </td>
                  <td className="py-2">{contract.commissionPercentage}%</td>
                  <td className="py-2">{contract.salesOwner.name}</td>
                  <td className="py-2">
                    <StatusBadge value={contract.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mt-6 overflow-x-auto">
        <h2 className="mb-3 text-sm font-medium">Faturat e fundit</h2>
        {client.bills.length === 0 ? (
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
              {client.bills.map((bill) => (
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
