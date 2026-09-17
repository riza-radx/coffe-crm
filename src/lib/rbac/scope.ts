import { permissionFor } from "./matrix";
import type { Action, Actor, Resource } from "./types";

/**
 * Ownership filter injected into every scoped list query.
 *
 * The plan is explicit that scoping happens at the query-builder level, not in the UI:
 *   prisma.contract.findMany({ where: { ...ownerFilter(actor, action, resource), ...filters } })
 *
 * Returns {} for "all" scope, { <field>: actor.id } for "own", and an
 * impossible predicate for "none" so a missed can() check still returns nothing.
 */
export function ownerFilter(
  actor: Actor,
  action: Action,
  resource: Resource,
  field = "salesOwnerId",
): Record<string, string> {
  const { scope } = permissionFor(actor, action, resource);
  if (scope === "all") return {};
  if (scope === "own") return { [field]: actor.id };
  return { [field]: "__denied__" };
}
