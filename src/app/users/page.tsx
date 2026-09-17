import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/dal";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/field";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Page-level check mirrors the API check; the API is the one that actually protects data.
  if (!can(user, "manage", "user")) redirect("/dashboard");

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, status: true, lastLoginAt: true },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Përdoruesit</h1>

      <Card className="mt-6">
        <h2 className="mb-4 text-sm font-medium">Fto një përdorues</h2>
        <InviteForm />
      </Card>

      <Card className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--muted)]">
            <tr>
              <th className="pb-2">Emri</th>
              <th className="pb-2">Email</th>
              <th className="pb-2">Roli</th>
              <th className="pb-2">Statusi</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--border)]">
                <td className="py-2">{u.name}</td>
                <td className="py-2">{u.email}</td>
                <td className="py-2">{u.role}</td>
                <td className="py-2">{u.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
