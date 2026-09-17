import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { can } from "@/lib/rbac";
import { CommissionsTable } from "./commissions-table";

export default async function CommissionsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  // "Approve/pay commissions — Yes / No / No". A rep still opens this page, but
  // it is their own payout list: the scope is enforced in the query, not here.
  const canApprove = can(user, "approve", "commission");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Komisionet</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {canApprove
          ? "Çdo komision është i ngrirë me përqindjen e kontratës në momentin e verifikimit."
          : "Këtu shfaqen vetëm komisionet e tua."}
      </p>

      <p className="mt-3 text-sm">
        <a
          href="/api/commissions?format=csv"
          className="underline underline-offset-2"
          download
        >
          Shkarko pasqyrën CSV
        </a>
        <span className="text-[var(--muted)]">
          {" "}— të njëjtat filtra si lista, i njëjti akses.
        </span>
      </p>

      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-[var(--muted)]">Duke ngarkuar…</p>}>
          <CommissionsTable canApprove={canApprove} />
        </Suspense>
      </div>
    </main>
  );
}
