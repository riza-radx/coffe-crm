import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit/log";
import { clientIp } from "@/lib/audit/request-context";
import { createInviteToken, inviteExpiry } from "@/lib/invites";
import { CreateInviteSchema } from "@/lib/validation/auth";
import { bodyWithLink, sendMail } from "@/lib/email/mailer";
import { config } from "@/lib/env";

export const runtime = "nodejs";

/**
 * POST /api/auth/invite — Super Admin only (RBAC table, row "Manage users/invites").
 * Creates the INVITED user row and its single-use token in one transaction.
 */
export const POST = withAuth("manage", "invite", async (request, { actor }) => {
  const body = await request.json().catch(() => null);
  const parsed = CreateInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { email, name, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "EMAIL_ALREADY_EXISTS" }, { status: 409 });
  }

  const token = createInviteToken();
  const expiresAt = inviteExpiry();

  const ip = clientIp(request);

  const invite = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name, role, status: "INVITED", invitedById: actor.id },
      select: { id: true },
    });
    const created = await tx.invite.create({
      data: { email, role, token, invitedById: actor.id, expiresAt },
      select: { id: true, email: true, role: true, token: true, expiresAt: true },
    });
    // The user row is what the audit follows; the token itself is a secret and
    // never enters a diff.
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: "USER",
      entityId: user.id,
      action: "CREATE",
      diff: { after: { email, name, role, status: "INVITED", invitedById: actor.id } },
      ip,
    });
    return created;
  });

  // Phase 5 delivers the invite by email. It is sent after the transaction, and a
  // failure is reported rather than thrown: the invite exists either way, and the
  // link is still in the response so an admin can pass it on by hand.
  const inviteUrl = `${config.appUrl}/invite/${invite.token}`;
  const mail = await sendMail({
    to: invite.email,
    subject: "Ftesë për në Rei CRM",
    text: bodyWithLink(
      `Përshëndetje ${name},\n\nJe ftuar në Rei CRM si ${role}. Hap lidhjen më poshtë për të vendosur fjalëkalimin. Ftesa skadon më ${invite.expiresAt.toISOString().slice(0, 10)}.`,
      `/invite/${invite.token}`,
    ),
  }).catch((error: unknown) => {
    console.error("[invite] email failed:", error);
    return { delivered: false };
  });

  return NextResponse.json(
    {
      emailDelivered: mail.delivered,
      inviteUrlAbsolute: inviteUrl,
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      inviteUrl: `/invite/${invite.token}`,
    },
    { status: 201 },
  );
});
