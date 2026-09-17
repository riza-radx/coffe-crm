import "server-only";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/api/errors";
import { permissionFor } from "@/lib/rbac";
import type { Actor } from "@/lib/rbac/types";
import { orderByFromSort, pageSlice, type Paginated } from "@/lib/validation/list-query";
import type {
  ListNotificationsQuery,
  UpdatePreferencesInput,
} from "@/lib/validation/notifications";
import {
  completePreferences,
  DEFAULT_PREFERENCE,
  type Preference,
  type PreferenceRow,
} from "@/lib/notifications/preferences";
import type { NotificationType } from "@/lib/notifications/types";

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
};

/**
 * A notification is addressed to exactly one user, so the scope is "own" for
 * every role — including Super Admin, who has no business reading a rep's bell.
 * The predicate comes from the matrix rather than being hard-coded here, so the
 * one place that could widen it is the matrix.
 */
function scopeWhere(actor: Actor): Record<string, unknown> {
  const { scope } = permissionFor(actor, "view", "notification");
  if (scope === "own") return { userId: actor.id };
  return { id: "__denied__" };
}

const ROW_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  readAt: true,
  entityType: true,
  entityId: true,
  createdAt: true,
} as const;

type RawRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: Date | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
};

function toRow(row: RawRow): NotificationRow {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Phase 6: `in_app = false` hides a type from the bell without stopping the row
 * being written — the notification is still the record that the event happened,
 * and an email may still point at it. The hiding is therefore a read-time filter,
 * and it lives here rather than in the component so the count and the list agree.
 */
async function mutedTypes(actor: Actor): Promise<string[]> {
  const rows = (await prisma.notificationPreference.findMany({
    where: { userId: actor.id, inApp: false },
    select: { type: true },
  })) as Array<{ type: string }>;
  return rows.map((row) => row.type);
}

export async function listNotifications(
  actor: Actor,
  query: ListNotificationsQuery,
): Promise<Paginated<NotificationRow> & { unread: number }> {
  const muted = await mutedTypes(actor);

  const filters: Record<string, unknown> = {};
  if (query.unread !== undefined) filters.readAt = query.unread ? null : { not: null };
  // An explicit ?type= wins over the mute: asking for a type by name is not the
  // bell showing it unasked.
  if (query.type) filters.type = query.type;
  else if (muted.length > 0) filters.type = { notIn: muted };

  const where = { AND: [scopeWhere(actor), filters] };
  const unreadWhere = {
    AND: [
      scopeWhere(actor),
      { readAt: null },
      ...(muted.length > 0 ? [{ type: { notIn: muted } }] : []),
    ],
  };
  const { skip, take } = pageSlice(query.page, query.pageSize);

  const [total, rows, unread] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      select: ROW_SELECT,
      orderBy: orderByFromSort(query.sort),
      skip,
      take,
    }),
    prisma.notification.count({ where: unreadWhere }),
  ]);

  return { data: rows.map(toRow), page: query.page, pageSize: query.pageSize, total, unread };
}

export async function unreadNotificationCount(actor: Actor): Promise<number> {
  const muted = await mutedTypes(actor);
  return prisma.notification.count({
    where: {
      AND: [
        scopeWhere(actor),
        { readAt: null },
        ...(muted.length > 0 ? [{ type: { notIn: muted } }] : []),
      ],
    },
  });
}

/** The settings screen: every type, with the defaults filled in for missing rows. */
export async function getNotificationPreferences(
  actor: Actor,
): Promise<Array<{ type: NotificationType } & Preference>> {
  const rows = (await prisma.notificationPreference.findMany({
    where: { userId: actor.id },
    select: { userId: true, type: true, inApp: true, email: true },
  })) as PreferenceRow[];
  return completePreferences(actor.id, rows);
}

/**
 * A full replacement of the caller's own preferences, in one transaction, so a
 * half-saved settings form cannot leave a user emailed about one thing and silent
 * about another for reasons nobody can reconstruct.
 *
 * A row equal to the default is deleted rather than stored: "no row" and "the
 * default" have to keep meaning the same thing, or a future change of default
 * would apply to some users and not others.
 */
export async function setNotificationPreferences(
  actor: Actor,
  input: UpdatePreferencesInput,
): Promise<Array<{ type: NotificationType } & Preference>> {
  await prisma.$transaction(async (tx) => {
    for (const pref of input.preferences) {
      const isDefault =
        pref.inApp === DEFAULT_PREFERENCE.inApp && pref.email === DEFAULT_PREFERENCE.email;
      if (isDefault) {
        await tx.notificationPreference.deleteMany({ where: { userId: actor.id, type: pref.type } });
        continue;
      }
      await tx.notificationPreference.upsert({
        where: { userId_type: { userId: actor.id, type: pref.type } },
        create: { userId: actor.id, type: pref.type, inApp: pref.inApp, email: pref.email },
        update: { inApp: pref.inApp, email: pref.email },
      });
    }
  });

  return getNotificationPreferences(actor);
}

/**
 * Marking your own bell as read is not a business mutation: it changes no money,
 * no status and nobody else's view, so it writes no audit entry. It is also
 * idempotent — a second click on an already-read row is a no-op, not a 409.
 */
export async function markNotificationRead(actor: Actor, id: string): Promise<NotificationRow> {
  const existing = await prisma.notification.findFirst({
    where: { AND: [scopeWhere(actor), { id }] },
    select: { id: true, readAt: true },
  });
  if (!existing) throw notFound("NOTIFICATION_NOT_FOUND");

  if (!existing.readAt) {
    await prisma.notification.updateMany({
      where: { id, userId: actor.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  const row = await prisma.notification.findFirst({
    where: { AND: [scopeWhere(actor), { id }] },
    select: ROW_SELECT,
  });
  if (!row) throw notFound("NOTIFICATION_NOT_FOUND");
  return toRow(row);
}
