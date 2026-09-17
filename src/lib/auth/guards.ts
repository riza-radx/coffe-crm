import { NextResponse } from "next/server";
import { can } from "@/lib/rbac";
import type { Action, Actor, Resource } from "@/lib/rbac/types";
import { toResponse } from "@/lib/api/errors";
import { requireUser, UnauthorizedError } from "./dal";

export function unauthorized() {
  return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
}

/**
 * Wraps a route handler so the can() check cannot be forgotten: 401 without an
 * active session, 403 when the role lacks the permission, and any ApiError thrown
 * further in becomes its own status code.
 *
 * `Ctx` is whatever Next passes as the second argument — for a dynamic segment that
 * is `{ params: Promise<{ id: string }> }`.
 */
export function withAuth<Ctx = unknown>(
  action: Action,
  resource: Resource,
  handler: (request: Request, context: { actor: Actor; ctx: Ctx }) => Promise<Response> | Response,
) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    let actor: Actor;
    try {
      actor = await requireUser();
    } catch (error) {
      if (error instanceof UnauthorizedError) return unauthorized();
      throw error;
    }
    if (!can(actor, action, resource)) return forbidden();
    try {
      return await handler(request, { actor, ctx });
    } catch (error) {
      return toResponse(error);
    }
  };
}

export type IdParams = { params: Promise<{ id: string }> };

export function validationError(issues: unknown) {
  return NextResponse.json({ error: "VALIDATION_ERROR", issues }, { status: 422 });
}
