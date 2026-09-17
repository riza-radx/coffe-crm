import { NextResponse } from "next/server";
import { withAuth, validationError } from "@/lib/auth/guards";
import { clientIp } from "@/lib/audit/request-context";
import { permissionFor } from "@/lib/rbac";
import { searchParamsToObject } from "@/lib/validation/list-query";
import { CreateClientSchema, ListClientsQuerySchema } from "@/lib/validation/clients";
import { createClient, listClients } from "@/lib/queries/clients";

export const runtime = "nodejs";

export const GET = withAuth("viewAll", "client", async (request, { actor }) => {
  const parsed = ListClientsQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
  if (!parsed.success) return validationError(parsed.error.issues);
  return NextResponse.json(await listClients(actor, parsed.data));
});

export const POST = withAuth("create", "client", async (request, { actor }) => {
  const parsed = CreateClientSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);

  // A rep may only bring in their own clients; only an actor with "all" scope may
  // attribute a client to someone else.
  const scope = permissionFor(actor, "create", "client").scope;
  const acquiredById = scope === "own" ? actor.id : (parsed.data.acquiredById ?? actor.id);

  const client = await createClient(actor, parsed.data, acquiredById, { ip: clientIp(request) });
  return NextResponse.json(client, { status: 201 });
});
