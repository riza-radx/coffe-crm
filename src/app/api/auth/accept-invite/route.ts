import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit/log";
import { clientIp } from "@/lib/audit/request-context";
import { inviteState } from "@/lib/invites";
import { hashPassword } from "@/lib/password";
import { AcceptInviteSchema } from "@/lib/validation/auth";
import { templates, writeNotifications } from "@/lib/notifications/notify";
import { enqueueNotificationEmails } from "@/lib/jobs/queue";

export const runtime = "nodejs";

const STATE_STATUS = {
  NOT_FOUND: 404,
  EXPIRED: 410,
  ALREADY_USED: 409,
} as const;

/**
 * POST /api/auth/accept-invite — public, but gated by a single-use token.
 * Sets the password and flips the user from INVITED to ACTIVE.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = AcceptInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { token, password } = parsed.data;

  const invite = await prisma.invite.findUnique({
    where: { token },
    select: { id: true, email: true, expiresAt: true, acceptedAt: true },
  });

  const state = inviteState(invite, new Date());
  if (state !== "VALID") {
    return NextResponse.json({ error: `INVITE_${state}` }, { status: STATE_STATUS[state] });
  }

  const user = await prisma.user.findUnique({
    where: { email: invite!.email },
    select: { id: true, status: true, name: true, email: true, invitedById: true },
  });
  if (!user || user.status !== "INVITED") {
    return NextResponse.json({ error: "INVITE_ALREADY_USED" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const ip = clientIp(request);

  const emails = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, status: "ACTIVE" },
    });
    await tx.invite.update({
      where: { id: invite!.id },
      data: { acceptedAt: new Date() },
    });
    // The actor is the invitee, who has no session yet — `actor_id` is the user
    // themselves, not null, because the row is about their own activation. The
    // password hash is never part of the diff.
    await writeAudit(tx, {
      actorId: user.id,
      entityType: "USER",
      entityId: user.id,
      action: "STATUS_CHANGE",
      diff: { before: { status: "INVITED" }, after: { status: "ACTIVE" } },
      ip,
    });

    // Section 8 lists "invite accepted" among the emailed events. It goes to the
    // admin who sent the invite — the only person waiting for it.
    if (!user.invitedById) return [];
    return writeNotifications(tx, [
      templates.inviteAccepted({
        userId: user.invitedById,
        newUserId: user.id,
        name: user.name,
        email: user.email,
      }),
    ]);
  });

  await enqueueNotificationEmails(emails);

  return NextResponse.json({ ok: true }, { status: 200 });
}
