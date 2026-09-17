import { prisma } from "@/lib/db";
import { inviteState } from "@/lib/invites";
import { Card } from "@/components/ui/field";
import { AcceptInviteForm } from "./accept-invite-form";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  NOT_FOUND: "Kjo ftesë nuk ekziston.",
  EXPIRED: "Kjo ftesë ka skaduar. Kërko një ftesë të re nga administratori.",
  ALREADY_USED: "Kjo ftesë është përdorur tashmë. Provo të hysh normalisht.",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({
    where: { token },
    select: { email: true, role: true, expiresAt: true, acceptedAt: true },
  });
  const state = inviteState(invite, new Date());

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full">
        <h1 className="text-xl font-semibold">Aktivizo llogarinë</h1>
        {state !== "VALID" ? (
          <p className="mt-2 text-sm text-[var(--danger)]">{MESSAGES[state]}</p>
        ) : (
          <>
            <p className="mb-6 mt-1 text-sm text-[var(--muted)]">
              {invite!.email} · roli {invite!.role}
            </p>
            <AcceptInviteForm token={token} />
          </>
        )}
      </Card>
    </main>
  );
}
