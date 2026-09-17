import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { getBill } from "@/lib/queries/bills";
import { ApiError } from "@/lib/api/errors";
import { formatDecimal } from "@/lib/api/decimal";
import { can, isOwnScoped } from "@/lib/rbac";
import { Card } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { BillActions } from "./bill-actions";

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const bill = await getBill(user, id).catch((error) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });

  // "Verify/dispute bill — Yes / Yes (own contracts) / No": internal Sales may
  // read every bill but only act on their own, so ownership is checked here too.
  const owns = bill.contract.salesOwner?.id === user.id;
  const canVerify = can(user, "verify", "bill") && (!isOwnScoped(user, "verify", "bill") || owns);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/bills" className="text-sm text-[var(--muted)] underline-offset-2 hover:underline">
        ← Faturat
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Fatura {bill.billNumber}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        <Link href={`/clients/${bill.client.id}`} className="underline-offset-2 hover:underline">
          {bill.client.name}
        </Link>{" "}
        · {bill.billDate} · regjistruar nga {bill.enteredBy.name}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-[var(--muted)]">Statusi</p>
          <p className="mt-2">
            <StatusBadge value={bill.status} />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--muted)]">Vlera</p>
          <p className="mt-2 text-xl font-semibold">
            {formatDecimal(bill.amount)} {bill.currency}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--muted)]">Komisioni</p>
          {bill.commission ? (
            <p className="mt-2 text-xl font-semibold">
              {formatDecimal(bill.commission.commissionAmount)}{" "}
              <StatusBadge value={bill.commission.status} />
            </p>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted)]">Krijohet me verifikimin</p>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="mb-1 text-sm font-medium">Rrjedha e verifikimit</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Verifikimi ngrin përqindjen e kontratës në komision. Kontestimi ose anulimi e kthen
          komisionin nëse ai është ende PENDING.
        </p>
        <BillActions bill={bill} canVerify={canVerify} />
      </Card>

      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-medium">Kontrata</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Kontrata</dt>
            <dd>
              <Link
                href={`/contracts/${bill.contract.id}`}
                className="underline-offset-2 hover:underline"
              >
                {bill.contract.id}
              </Link>{" "}
              <StatusBadge value={bill.contract.status} />
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Përfaqësuesi</dt>
            <dd>{bill.contract.salesOwner?.name ?? "—"}</dd>
          </div>
        </dl>
      </Card>
    </main>
  );
}
