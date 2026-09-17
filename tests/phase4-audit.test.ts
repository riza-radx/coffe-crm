import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, Role } from "@/lib/rbac/types";

let currentActor: Actor | null = null;

class UnauthorizedError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

vi.mock("@/lib/auth/dal", () => ({
  UnauthorizedError,
  requireUser: async () => {
    if (!currentActor) throw new UnauthorizedError();
    return currentActor;
  },
  getSession: async () => null,
  currentUser: async () => currentActor,
}));

function model() {
  return {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  };
}

const MODELS = ["user", "client", "contract", "bill", "commission", "invite", "auditLog", "notification", "notificationPreference"] as const;

/**
 * The transaction client is a *different* object from the top-level client, so an
 * audit entry written outside the transaction shows up as a call on `db.auditLog`
 * rather than on `tx.auditLog`. Phase 3 established this harness; Phase 4 uses it
 * to check the mutations it retrofitted.
 */
const tx = Object.fromEntries(MODELS.map((name) => [name, model()])) as Record<
  (typeof MODELS)[number],
  ReturnType<typeof model>
>;

const db = {
  ...(Object.fromEntries(MODELS.map((name) => [name, model()])) as Record<
    (typeof MODELS)[number],
    ReturnType<typeof model>
  >),
  $transaction: vi.fn(),
};

vi.mock("@/lib/db", () => ({ prisma: db }));

const clients = await import("@/app/api/clients/route");
const clientById = await import("@/app/api/clients/[id]/route");
const contracts = await import("@/app/api/contracts/route");
const contractById = await import("@/app/api/contracts/[id]/route");
const invite = await import("@/app/api/auth/invite/route");
const acceptInvite = await import("@/app/api/auth/accept-invite/route");

const as = (role: Role): Actor => ({ id: `u-${role}`, role });
const NO_CTX = {} as never;
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const decimal = (value: string) => ({ toFixed: (dp: number) => Number(value).toFixed(dp) });

const send = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const CLIENT_ROW = {
  id: "c1",
  name: "Bar Rei",
  type: "BAR",
  city: "Tirana",
  status: "LEAD",
  contactName: null,
  contactPhone: null,
  createdAt: new Date("2026-09-17T00:00:00Z"),
  acquiredBy: { id: "u-SALES", name: "Rep" },
  address: null,
  contactEmail: null,
  taxId: null,
  acquiredById: "u-SALES",
};

const CONTRACT_ROW = {
  id: "k1",
  status: "DRAFT",
  commissionPercentage: decimal("7.50"),
  startDate: new Date("2026-09-01T00:00:00Z"),
  endDate: null,
  createdAt: new Date("2026-09-17T00:00:00Z"),
  client: { id: "c1", name: "Bar Rei" },
  salesOwner: { id: "u-SALES", name: "Rep" },
};

function existingContract(overrides: Record<string, unknown> = {}) {
  return {
    id: "k1",
    status: "ACTIVE",
    salesOwnerId: "u-SALES",
    commissionPercentage: decimal("7.50"),
    startDate: new Date("2026-09-01T00:00:00Z"),
    endDate: null,
    paymentTerms: null,
    notes: null,
    signedDocumentUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  currentActor = null;
  vi.clearAllMocks();
  for (const store of [db, tx]) {
    for (const key of MODELS) {
      store[key].findUnique.mockResolvedValue(null);
      store[key].findFirst.mockResolvedValue(null);
      store[key].findMany.mockResolvedValue([]);
      store[key].count.mockResolvedValue(0);
      store[key].create.mockResolvedValue({});
      store[key].createMany.mockResolvedValue({ count: 0 });
      store[key].update.mockResolvedValue({});
    }
  }
  db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));

  tx.client.create.mockResolvedValue(CLIENT_ROW);
  tx.client.update.mockResolvedValue(CLIENT_ROW);
  tx.client.findFirst.mockResolvedValue({ id: "c1" });
  tx.contract.create.mockResolvedValue(CONTRACT_ROW);
  tx.contract.update.mockResolvedValue(CONTRACT_ROW);
  tx.user.create.mockResolvedValue({ id: "new-user" });
  tx.invite.create.mockResolvedValue({
    id: "inv-1",
    email: "rep@radx.app",
    role: "SALES",
    token: "t".repeat(43),
    expiresAt: new Date("2026-09-20T10:00:00Z"),
  });
});

/** Every audit entry written on the transaction client, across all its calls. */
function auditEntries() {
  return tx.auditLog.create.mock.calls.map((call) => call[0].data);
}

describe("client mutations leave a trace", () => {
  it("logs a creation, inside the transaction, with the new values", async () => {
    currentActor = as("SALES");
    const response = await clients.POST(
      send("POST", "http://t/api/clients", { name: "Bar Rei", type: "BAR", city: "Tirana" }, {
        "x-forwarded-for": "203.0.113.5, 10.0.0.1",
      }),
      NO_CTX,
    );
    expect(response.status).toBe(201);

    const entries = auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: "u-SALES",
      entityType: "CLIENT",
      entityId: "c1",
      action: "CREATE",
      ipAddress: "203.0.113.5",
    });
    expect(entries[0].diff.after).toMatchObject({ name: "Bar Rei", type: "BAR" });
    // Never on the top-level client: an entry outside the transaction could
    // survive a mutation that rolled back.
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("logs only the fields an update actually changed", async () => {
    currentActor = as("SUPER_ADMIN");
    tx.client.findFirst.mockResolvedValue({ ...CLIENT_ROW, city: "Tirana", status: "LEAD" });

    await clientById.PATCH(
      send("PATCH", "http://t/api/clients/c1", { city: "Durrës" }),
      idCtx("c1"),
    );

    const entries = auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("UPDATE");
    expect(entries[0].diff).toEqual({ before: { city: "Tirana" }, after: { city: "Durrës" } });
  });

  it("writes nothing when a PATCH changes nothing", async () => {
    currentActor = as("SUPER_ADMIN");
    tx.client.findFirst.mockResolvedValue({ ...CLIENT_ROW, city: "Tirana" });
    await clientById.PATCH(send("PATCH", "http://t/api/clients/c1", { city: "Tirana" }), idCtx("c1"));
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("leaves no trace when the mutation is refused", async () => {
    currentActor = as("OUTSIDE_SALES");
    tx.client.findFirst.mockResolvedValue(null); // not visible to this rep
    const response = await clientById.PATCH(
      send("PATCH", "http://t/api/clients/c1", { city: "Durrës" }),
      idCtx("c1"),
    );
    expect(response.status).toBe(404);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("contract mutations leave a trace", () => {
  it("logs a creation with the frozen percentage", async () => {
    currentActor = as("SALES");
    const response = await contracts.POST(
      send("POST", "http://t/api/contracts", {
        clientId: "c1",
        commissionPercentage: "7.50",
        startDate: "2026-09-01",
      }),
      NO_CTX,
    );
    expect(response.status).toBe(201);

    const entries = auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityType: "CONTRACT", entityId: "k1", action: "CREATE" });
    expect(entries[0].diff.after).toMatchObject({
      commissionPercentage: "7.50",
      status: "DRAFT",
      salesOwnerId: "u-SALES",
    });
  });

  it("logs a status move as STATUS_CHANGE", async () => {
    currentActor = as("SALES");
    tx.contract.findFirst.mockResolvedValue(existingContract({ status: "DRAFT" }));

    await contractById.PATCH(
      send("PATCH", "http://t/api/contracts/k1", { status: "ACTIVE" }),
      idCtx("k1"),
    );

    const entries = auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("STATUS_CHANGE");
    expect(entries[0].diff).toEqual({ before: { status: "DRAFT" }, after: { status: "ACTIVE" } });
  });

  /**
   * The amend is the mutation the plan singles out — "commission % editable only
   * via an explicit audit-logged amend action". It gets its own entry so that
   * "who changed the percentage" is a query, not a scan of diffs.
   */
  it("logs an amendment of the commission percentage as its own entry", async () => {
    currentActor = as("SUPER_ADMIN");
    tx.contract.findFirst.mockResolvedValue(existingContract());

    await contractById.PATCH(
      send("PATCH", "http://t/api/contracts/k1", { commissionPercentage: "9.00", notes: "rishikim" }),
      idCtx("k1"),
    );

    const entries = auditEntries();
    expect(entries).toHaveLength(2);
    const amend = entries.find((entry) => entry.diff?.amend === "commissionPercentage");
    expect(amend).toBeDefined();
    expect(amend.diff.before).toEqual({ commissionPercentage: "7.50" });
    expect(amend.diff.after).toEqual({ commissionPercentage: "9.00" });
    // The ordinary field edit is a separate row, not folded into the amendment.
    const fields = entries.find((entry) => entry.diff?.after?.notes !== undefined);
    expect(fields.diff.after).toEqual({ notes: "rishikim" });
  });

  it("writes nothing when a forbidden amendment is refused", async () => {
    currentActor = as("SALES");
    tx.contract.findFirst.mockResolvedValue(existingContract());
    const response = await contractById.PATCH(
      send("PATCH", "http://t/api/contracts/k1", { commissionPercentage: "9.00" }),
      idCtx("k1"),
    );
    expect(response.status).toBe(403);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it("writes nothing when the state machine refuses the transition", async () => {
    currentActor = as("SALES");
    tx.contract.findFirst.mockResolvedValue(existingContract({ status: "EXPIRED" }));
    const response = await contractById.PATCH(
      send("PATCH", "http://t/api/contracts/k1", { status: "ACTIVE" }),
      idCtx("k1"),
    );
    expect(response.status).toBe(409);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("user mutations leave a trace", () => {
  it("logs the invited user, without the token", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await invite.POST(
      send("POST", "http://t/api/auth/invite", {
        email: "rep@radx.app",
        name: "Rep One",
        role: "SALES",
      }),
      NO_CTX,
    );
    expect(response.status).toBe(201);

    const entries = auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: "u-SUPER_ADMIN",
      entityType: "USER",
      entityId: "new-user",
      action: "CREATE",
    });
    expect(JSON.stringify(entries[0])).not.toContain("t".repeat(43));
  });

  it("logs the activation against the invitee, without the password", async () => {
    db.invite.findUnique.mockResolvedValue({
      id: "inv-1",
      email: "rep@radx.app",
      expiresAt: new Date(Date.now() + 86_400_000),
      acceptedAt: null,
    });
    db.user.findUnique.mockResolvedValue({ id: "u-new", status: "INVITED" });

    const response = await acceptInvite.POST(
      send("POST", "http://t/api/auth/accept-invite", {
        token: "t".repeat(43),
        password: "fjalekalim-i-gjate",
        confirmPassword: "fjalekalim-i-gjate",
      }),
    );
    expect(response.status).toBe(200);

    const entries = auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      // No session yet: the actor is the invitee, activating their own account.
      actorId: "u-new",
      entityType: "USER",
      entityId: "u-new",
      action: "STATUS_CHANGE",
    });
    expect(entries[0].diff).toEqual({ before: { status: "INVITED" }, after: { status: "ACTIVE" } });
    expect(JSON.stringify(entries[0])).not.toContain("fjalekalim");
  });
});
