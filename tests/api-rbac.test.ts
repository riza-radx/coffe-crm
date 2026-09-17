import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, Role } from "@/lib/rbac/types";
import { ROLES } from "@/lib/rbac/types";

/** Swapped per test to impersonate a role, or null for an anonymous caller. */
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

const db = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
  },
  invite: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  // Phase 4: inviting and accepting an invite are user mutations, so both write
  // an audit entry inside their existing transaction.
  auditLog: {
    create: vi.fn(),
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock("@/lib/db", () => ({ prisma: db }));

const { POST: createInvite } = await import("@/app/api/auth/invite/route");
const { POST: acceptInvite } = await import("@/app/api/auth/accept-invite/route");
const { GET: listUsers } = await import("@/app/api/users/route");

const as = (role: Role): Actor => ({ id: `u-${role}`, role });

const postJson = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Route handlers take Next's context as a second argument; these routes ignore it. */
const NO_CTX = {} as never;

beforeEach(() => {
  currentActor = null;
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  db.user.findUnique.mockResolvedValue(null);
  db.user.create.mockResolvedValue({ id: "new-user" });
  db.auditLog.create.mockResolvedValue({ id: "a1" });
  db.auditLog.createMany.mockResolvedValue({ count: 0 });
  db.user.count.mockResolvedValue(0);
  db.user.findMany.mockResolvedValue([]);
  db.invite.create.mockResolvedValue({
    id: "inv-1",
    email: "rep@radx.app",
    role: "SALES",
    token: "t".repeat(43),
    expiresAt: new Date("2026-09-20T10:00:00.000Z"),
  });
});

/**
 * 3 roles x 3 endpoints. The expectation is on the HTTP status the handler
 * returns, not on anything the UI does.
 */
describe("POST /api/auth/invite", () => {
  const body = { email: "rep@radx.app", name: "Rep One", role: "SALES" };

  it("401 without a session", async () => {
    const response = await createInvite(postJson("http://t/api/auth/invite", body), NO_CTX);
    expect(response.status).toBe(401);
    expect(db.user.create).not.toHaveBeenCalled();
  });

  const expected: Record<Role, number> = { SUPER_ADMIN: 201, SALES: 403, OUTSIDE_SALES: 403 };
  for (const role of ROLES) {
    it(`${role} → ${expected[role]}`, async () => {
      currentActor = as(role);
      const response = await createInvite(postJson("http://t/api/auth/invite", body), NO_CTX);
      expect(response.status).toBe(expected[role]);
      if (expected[role] !== 201) expect(db.user.create).not.toHaveBeenCalled();
    });
  }

  it("creates the INVITED user and the token in one transaction", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await createInvite(postJson("http://t/api/auth/invite", body), NO_CTX);
    const payload = await response.json();
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "INVITED", invitedById: "u-SUPER_ADMIN" }),
      }),
    );
    expect(payload.inviteUrl).toMatch(/^\/invite\//);
    expect(payload).not.toHaveProperty("token");
  });

  it("422 on an invalid payload, before touching the database", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await createInvite(
      postJson("http://t/api/auth/invite", { email: "not-an-email", name: "x", role: "KING" }),
      NO_CTX,
    );
    expect(response.status).toBe(422);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("409 when the email already exists", async () => {
    currentActor = as("SUPER_ADMIN");
    db.user.findUnique.mockResolvedValue({ id: "existing" });
    const response = await createInvite(postJson("http://t/api/auth/invite", body), NO_CTX);
    expect(response.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("GET /api/users", () => {
  it("401 without a session", async () => {
    const response = await listUsers(new Request("http://t/api/users"), NO_CTX);
    expect(response.status).toBe(401);
  });

  const expected: Record<Role, number> = { SUPER_ADMIN: 200, SALES: 403, OUTSIDE_SALES: 403 };
  for (const role of ROLES) {
    it(`${role} → ${expected[role]}`, async () => {
      currentActor = as(role);
      const response = await listUsers(new Request("http://t/api/users"), NO_CTX);
      expect(response.status).toBe(expected[role]);
      if (expected[role] !== 200) expect(db.user.findMany).not.toHaveBeenCalled();
    });
  }

  it("always paginates server-side", async () => {
    currentActor = as("SUPER_ADMIN");
    await listUsers(new Request("http://t/api/users?page=3&pageSize=10"), NO_CTX);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it("caps pageSize instead of returning an unbounded set", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await listUsers(new Request("http://t/api/users?pageSize=100000"), NO_CTX);
    expect(response.status).toBe(422);
  });
});

describe("POST /api/auth/accept-invite", () => {
  const valid = {
    token: "t".repeat(43),
    password: "a-long-enough-password",
    confirmPassword: "a-long-enough-password",
  };

  it("is reachable without a session, for every role and for none", async () => {
    db.invite.findUnique.mockResolvedValue({
      id: "inv-1",
      email: "rep@radx.app",
      expiresAt: new Date(Date.now() + 3_600_000),
      acceptedAt: null,
    });
    db.user.findUnique.mockResolvedValue({ id: "u1", status: "INVITED" });

    for (const actor of [null, as("SALES"), as("OUTSIDE_SALES")]) {
      currentActor = actor;
      const response = await acceptInvite(postJson("http://t/api/auth/accept-invite", valid));
      expect(response.status).toBe(200);
    }
  });

  it("activates the user and consumes the invite in one transaction", async () => {
    db.invite.findUnique.mockResolvedValue({
      id: "inv-1",
      email: "rep@radx.app",
      expiresAt: new Date(Date.now() + 3_600_000),
      acceptedAt: null,
    });
    db.user.findUnique.mockResolvedValue({ id: "u1", status: "INVITED" });

    await acceptInvite(postJson("http://t/api/auth/accept-invite", valid));

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE" }) }),
    );
    const passwordHash = db.user.update.mock.calls[0][0].data.passwordHash;
    expect(passwordHash).toMatch(/^\$2[aby]\$/);
    expect(db.invite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acceptedAt: expect.any(Date) }) }),
    );
  });

  it("404 for an unknown token", async () => {
    db.invite.findUnique.mockResolvedValue(null);
    const response = await acceptInvite(postJson("http://t/api/auth/accept-invite", valid));
    expect(response.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("410 for an expired token", async () => {
    db.invite.findUnique.mockResolvedValue({
      id: "inv-1",
      email: "rep@radx.app",
      expiresAt: new Date(Date.now() - 1_000),
      acceptedAt: null,
    });
    const response = await acceptInvite(postJson("http://t/api/auth/accept-invite", valid));
    expect(response.status).toBe(410);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("409 for a token that was already used", async () => {
    db.invite.findUnique.mockResolvedValue({
      id: "inv-1",
      email: "rep@radx.app",
      expiresAt: new Date(Date.now() + 3_600_000),
      acceptedAt: new Date(),
    });
    const response = await acceptInvite(postJson("http://t/api/auth/accept-invite", valid));
    expect(response.status).toBe(409);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("422 when the two passwords differ", async () => {
    const response = await acceptInvite(
      postJson("http://t/api/auth/accept-invite", { ...valid, confirmPassword: "different" }),
    );
    expect(response.status).toBe(422);
  });
});
