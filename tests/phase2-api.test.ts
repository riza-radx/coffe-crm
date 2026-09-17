import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES, type Actor, type Role } from "@/lib/rbac/types";

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
    count: vi.fn(),
    aggregate: vi.fn(),
  };
}

const db = {
  user: model(),
  client: model(),
  contract: model(),
  bill: model(),
  commission: model(),
  invite: model(),
  auditLog: model(),
  $transaction: vi.fn(),
};

vi.mock("@/lib/db", () => ({ prisma: db }));

const clients = await import("@/app/api/clients/route");
const clientById = await import("@/app/api/clients/[id]/route");
const contracts = await import("@/app/api/contracts/route");
const contractById = await import("@/app/api/contracts/[id]/route");
const bills = await import("@/app/api/bills/route");

const as = (role: Role): Actor => ({ id: `u-${role}`, role });
const NO_CTX = {} as never;
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const get = (url: string) => new Request(url);
const send = (method: string, url: string, body: unknown) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const CLIENT_BODY = { name: "Bar Rei", type: "BAR", city: "Tirana" };
const CONTRACT_BODY = {
  clientId: "c1",
  commissionPercentage: "7.50",
  startDate: "2026-09-01",
};
const BILL_BODY = {
  contractId: "k1",
  billNumber: "F-001",
  amount: "120000.00",
  billDate: "2026-09-10",
};

beforeEach(() => {
  currentActor = null;
  vi.clearAllMocks();
  for (const key of [
    "user",
    "client",
    "contract",
    "bill",
    "commission",
    "invite",
    "auditLog",
  ] as const) {
    db[key].findUnique.mockResolvedValue(null);
    db[key].findFirst.mockResolvedValue(null);
    db[key].findMany.mockResolvedValue([]);
    db[key].count.mockResolvedValue(0);
    db[key].create.mockResolvedValue({});
    db[key].createMany.mockResolvedValue({ count: 0 });
    db[key].update.mockResolvedValue({});
    db[key].aggregate.mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } });
  }
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));

  // Rows the create paths read back, shaped like the service's `select`.
  db.client.create.mockResolvedValue({
    id: "c1",
    name: "Bar Rei",
    type: "BAR",
    city: "Tirana",
    status: "LEAD",
    contactName: null,
    contactPhone: null,
    createdAt: new Date("2026-09-17T00:00:00Z"),
    acquiredBy: { id: "u-SALES", name: "Rep" },
  });
  db.contract.create.mockResolvedValue({
    id: "k1",
    status: "DRAFT",
    commissionPercentage: { toFixed: (dp: number) => (7.5).toFixed(dp) },
    startDate: new Date("2026-09-01T00:00:00Z"),
    endDate: null,
    createdAt: new Date("2026-09-17T00:00:00Z"),
    client: { id: "c1", name: "Bar Rei" },
    salesOwner: { id: "u-SALES", name: "Rep" },
  });
  // PATCH reads the row back through the same select as the list.
  db.contract.update.mockResolvedValue({
    id: "k1",
    status: "ACTIVE",
    commissionPercentage: { toFixed: (dp: number) => (7.5).toFixed(dp) },
    startDate: new Date("2026-09-01T00:00:00Z"),
    endDate: null,
    createdAt: new Date("2026-09-17T00:00:00Z"),
    client: { id: "c1", name: "Bar Rei" },
    salesOwner: { id: "u-SALES", name: "Rep" },
  });
  db.client.update.mockResolvedValue({
    id: "c1",
    name: "Bar Rei",
    type: "BAR",
    city: "Tirana",
    status: "LEAD",
    contactName: null,
    contactPhone: null,
    createdAt: new Date("2026-09-17T00:00:00Z"),
    acquiredBy: { id: "u-SALES", name: "Rep" },
  });
  db.bill.create.mockResolvedValue({
    id: "f1",
    billNumber: "F-001",
    amount: { toFixed: (dp: number) => (120000).toFixed(dp) },
    currency: "ALL",
    billDate: new Date("2026-09-10T00:00:00Z"),
    status: "PENDING",
    client: { id: "c1", name: "Bar Rei" },
    contract: { id: "k1", status: "ACTIVE" },
    enteredBy: { id: "u-SALES", name: "Rep" },
  });
});

/**
 * The row `updateContract` selects before writing. Phase 4 widened that select so
 * the audit diff can carry before/after values, so a partial stub is no longer a
 * faithful stand-in for the database.
 */
function existingContract(overrides: Record<string, unknown> = {}) {
  return {
    id: "k1",
    status: "ACTIVE",
    salesOwnerId: "u-SALES",
    commissionPercentage: { toFixed: (dp: number) => (7.5).toFixed(dp) },
    startDate: new Date("2026-09-01T00:00:00Z"),
    endDate: null,
    paymentTerms: null,
    notes: null,
    signedDocumentUrl: null,
    ...overrides,
  };
}

/** The where clause the last findMany/count received, for scope assertions. */
function lastWhere(m: ReturnType<typeof model>) {
  return m.findMany.mock.calls.at(-1)?.[0]?.where;
}

describe("3 roles x 3 endpoints", () => {
  const cases = [
    {
      name: "POST /api/clients",
      call: (r: Request) => clients.POST(r, NO_CTX),
      body: CLIENT_BODY,
      expected: { SUPER_ADMIN: 201, SALES: 201, OUTSIDE_SALES: 201 } as Record<Role, number>,
    },
    {
      name: "POST /api/contracts",
      call: (r: Request) => contracts.POST(r, NO_CTX),
      body: CONTRACT_BODY,
      expected: { SUPER_ADMIN: 201, SALES: 201, OUTSIDE_SALES: 403 } as Record<Role, number>,
    },
    {
      name: "POST /api/bills",
      call: (r: Request) => bills.POST(r, NO_CTX),
      body: BILL_BODY,
      expected: { SUPER_ADMIN: 201, SALES: 201, OUTSIDE_SALES: 201 } as Record<Role, number>,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → 401 without a session`, async () => {
      const response = await testCase.call(send("POST", "http://t/x", testCase.body));
      expect(response.status).toBe(401);
    });

    for (const role of ROLES) {
      it(`${testCase.name} · ${role} → ${testCase.expected[role]}`, async () => {
        currentActor = as(role);
        // The client / contract each path reads before writing.
        db.client.findFirst.mockResolvedValue({ id: "c1" });
        db.contract.findUnique.mockResolvedValue({
          id: "k1",
          status: "ACTIVE",
          clientId: "c1",
          salesOwnerId: `u-${role}`,
        });
        const response = await testCase.call(send("POST", "http://t/x", testCase.body));
        expect(response.status).toBe(testCase.expected[role]);
      });
    }
  }
});

describe("list scoping happens in the query", () => {
  it("Outside Sales only sees clients they brought in", async () => {
    currentActor = as("OUTSIDE_SALES");
    await clients.GET(get("http://t/api/clients"), NO_CTX);
    expect(lastWhere(db.client)).toEqual({
      AND: [{ acquiredById: "u-OUTSIDE_SALES" }, {}],
    });
  });

  it("internal Sales sees every client", async () => {
    currentActor = as("SALES");
    await clients.GET(get("http://t/api/clients"), NO_CTX);
    expect(lastWhere(db.client)).toEqual({ AND: [{}, {}] });
  });

  it("a salesOwner query parameter cannot widen an Outside Sales scope", async () => {
    currentActor = as("OUTSIDE_SALES");
    await clients.GET(get("http://t/api/clients?salesOwner=u-SALES"), NO_CTX);
    // Both predicates survive inside AND, so the scope still applies and the
    // combination matches nothing rather than leaking another rep's clients.
    expect(lastWhere(db.client)).toEqual({
      AND: [{ acquiredById: "u-OUTSIDE_SALES" }, { acquiredById: "u-SALES" }],
    });
  });

  it("Outside Sales only sees contracts they own", async () => {
    currentActor = as("OUTSIDE_SALES");
    await contracts.GET(get("http://t/api/contracts"), NO_CTX);
    expect(lastWhere(db.contract)).toEqual({ AND: [{ salesOwnerId: "u-OUTSIDE_SALES" }, {}] });
  });

  it("bills inherit contract scope through the relation", async () => {
    currentActor = as("OUTSIDE_SALES");
    await bills.GET(get("http://t/api/bills"), NO_CTX);
    expect(lastWhere(db.bill)).toEqual({
      AND: [{ contract: { salesOwnerId: "u-OUTSIDE_SALES" } }, {}],
    });
  });

  it("paginates server-side and never returns an unbounded set", async () => {
    currentActor = as("SALES");
    await clients.GET(get("http://t/api/clients?page=3&pageSize=10"), NO_CTX);
    expect(db.client.findMany.mock.calls.at(-1)?.[0]).toMatchObject({ skip: 20, take: 10 });

    const tooBig = await clients.GET(get("http://t/api/clients?pageSize=5000"), NO_CTX);
    expect(tooBig.status).toBe(422);
  });

  it("rejects a sort field that is not allowlisted, before touching the database", async () => {
    currentActor = as("SALES");
    const response = await clients.GET(get("http://t/api/clients?sort=passwordHash:asc"), NO_CTX);
    expect(response.status).toBe(422);
    expect(db.client.findMany).not.toHaveBeenCalled();
  });

  it("turns an allowlisted sort into an orderBy", async () => {
    currentActor = as("SALES");
    await clients.GET(get("http://t/api/clients?sort=name:asc"), NO_CTX);
    expect(db.client.findMany.mock.calls.at(-1)?.[0]).toMatchObject({ orderBy: { name: "asc" } });
  });
});

describe("clients: who a client is attributed to", () => {
  it("forces a rep's own id even when the body says otherwise", async () => {
    currentActor = as("OUTSIDE_SALES");
    await clients.POST(
      send("POST", "http://t/api/clients", { ...CLIENT_BODY, acquiredById: "u-SALES" }),
      NO_CTX,
    );
    expect(db.client.create.mock.calls[0][0].data.acquiredById).toBe("u-OUTSIDE_SALES");
  });

  it("lets a Super Admin attribute a client to a rep", async () => {
    currentActor = as("SUPER_ADMIN");
    await clients.POST(
      send("POST", "http://t/api/clients", { ...CLIENT_BODY, acquiredById: "u-SALES" }),
      NO_CTX,
    );
    expect(db.client.create.mock.calls[0][0].data.acquiredById).toBe("u-SALES");
  });

  it("refuses reassignment by anyone but a Super Admin", async () => {
    currentActor = as("SALES");
    db.client.findFirst.mockResolvedValue({ id: "c1" });
    const response = await clientById.PATCH(
      send("PATCH", "http://t/api/clients/c1", { acquiredById: "u-OUTSIDE_SALES" }),
      idCtx("c1"),
    );
    expect(response.status).toBe(403);
    expect(db.client.update).not.toHaveBeenCalled();
  });

  it("reports a client outside the caller's scope as missing", async () => {
    currentActor = as("OUTSIDE_SALES");
    db.client.findFirst.mockResolvedValue(null);
    const response = await clientById.PATCH(
      send("PATCH", "http://t/api/clients/c1", { name: "Renamed" }),
      idCtx("c1"),
    );
    expect(response.status).toBe(404);
  });
});

describe("contracts: creation and the DRAFT to ACTIVE transition", () => {
  beforeEach(() => {
    db.client.findFirst.mockResolvedValue({ id: "c1" });
  });

  it("always starts a contract as DRAFT", async () => {
    currentActor = as("SALES");
    await contracts.POST(send("POST", "http://t/api/contracts", CONTRACT_BODY), NO_CTX);
    expect(db.contract.create.mock.calls[0][0].data).toMatchObject({
      status: "DRAFT",
      commissionPercentage: "7.50",
    });
  });

  it("stores the commission percentage as given, not as a float", async () => {
    currentActor = as("SALES");
    await contracts.POST(
      send("POST", "http://t/api/contracts", { ...CONTRACT_BODY, commissionPercentage: "7.05" }),
      NO_CTX,
    );
    expect(db.contract.create.mock.calls[0][0].data.commissionPercentage).toBe("7.05");
  });

  it("rejects an end date before the start date", async () => {
    currentActor = as("SALES");
    const response = await contracts.POST(
      send("POST", "http://t/api/contracts", { ...CONTRACT_BODY, endDate: "2026-08-01" }),
      NO_CTX,
    );
    expect(response.status).toBe(422);
    expect(db.contract.create).not.toHaveBeenCalled();
  });

  it("activates a DRAFT contract", async () => {
    currentActor = as("SALES");
    db.contract.findFirst.mockResolvedValue(existingContract({ status: "DRAFT" }));
    const response = await contractById.PATCH(
      send("PATCH", "http://t/api/contracts/k1", { status: "ACTIVE" }),
      idCtx("k1"),
    );
    expect(response.status).toBe(200);
    expect(db.contract.update.mock.calls[0][0].data).toEqual({ status: "ACTIVE" });
  });

  it("refuses a transition the state machine forbids", async () => {
    currentActor = as("SALES");
    db.contract.findFirst.mockResolvedValue(existingContract({ status: "EXPIRED" }));
    const response = await contractById.PATCH(
      send("PATCH", "http://t/api/contracts/k1", { status: "ACTIVE" }),
      idCtx("k1"),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "TRANSITION_INVALID_TRANSITION" });
  });

  it("refuses a transition that has an endpoint of its own", async () => {
    currentActor = as("SUPER_ADMIN");
    db.contract.findFirst.mockResolvedValue(existingContract());
    const response = await contractById.PATCH(
      send("PATCH", "http://t/api/contracts/k1", { status: "TERMINATED" }),
      idCtx("k1"),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "TRANSITION_WRONG_CHANNEL" });
  });
});

describe("contracts: the commission percentage is Super Admin only", () => {
  beforeEach(() => {
    db.contract.findFirst.mockResolvedValue(existingContract());
  });

  const expected: Record<Role, number> = { SUPER_ADMIN: 200, SALES: 403, OUTSIDE_SALES: 403 };
  for (const role of ROLES) {
    it(`${role} → ${expected[role]}`, async () => {
      currentActor = as(role);
      if (role === "OUTSIDE_SALES") {
        db.contract.findFirst.mockResolvedValue(existingContract({ salesOwnerId: "u-OUTSIDE_SALES" }));
      }
      const response = await contractById.PATCH(
        send("PATCH", "http://t/api/contracts/k1", { commissionPercentage: "9.00" }),
        idCtx("k1"),
      );
      expect(response.status).toBe(expected[role]);
      if (expected[role] !== 200) expect(db.contract.update).not.toHaveBeenCalled();
    });
  }
});

describe("bills: what a bill may attach to", () => {
  it("refuses a DRAFT contract", async () => {
    currentActor = as("SALES");
    db.contract.findUnique.mockResolvedValue({
      id: "k1",
      status: "DRAFT",
      clientId: "c1",
      salesOwnerId: "u-SALES",
    });
    const response = await bills.POST(send("POST", "http://t/api/bills", BILL_BODY), NO_CTX);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "CONTRACT_NOT_ACTIVE" });
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it("refuses every non-ACTIVE status", async () => {
    currentActor = as("SUPER_ADMIN");
    for (const status of ["DRAFT", "EXPIRED", "TERMINATED", "RENEWED"]) {
      db.contract.findUnique.mockResolvedValue({
        id: "k1",
        status,
        clientId: "c1",
        salesOwnerId: "u-SUPER_ADMIN",
      });
      const response = await bills.POST(send("POST", "http://t/api/bills", BILL_BODY), NO_CTX);
      expect(response.status).toBe(409);
    }
  });

  it("reports another rep's contract as missing rather than forbidden", async () => {
    currentActor = as("OUTSIDE_SALES");
    db.contract.findUnique.mockResolvedValue({
      id: "k1",
      status: "ACTIVE",
      clientId: "c1",
      salesOwnerId: "u-SALES",
    });
    const response = await bills.POST(send("POST", "http://t/api/bills", BILL_BODY), NO_CTX);
    expect(response.status).toBe(404);
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it("lets a Super Admin bill any contract", async () => {
    currentActor = as("SUPER_ADMIN");
    db.contract.findUnique.mockResolvedValue({
      id: "k1",
      status: "ACTIVE",
      clientId: "c1",
      salesOwnerId: "u-SALES",
    });
    const response = await bills.POST(send("POST", "http://t/api/bills", BILL_BODY), NO_CTX);
    expect(response.status).toBe(201);
  });

  it("takes clientId and enteredBy from the contract and the session, not the request", async () => {
    currentActor = as("SALES");
    db.contract.findUnique.mockResolvedValue({
      id: "k1",
      status: "ACTIVE",
      clientId: "c1",
      salesOwnerId: "u-SALES",
    });
    await bills.POST(
      send("POST", "http://t/api/bills", { ...BILL_BODY, clientId: "someone-elses-client" }),
      NO_CTX,
    );
    expect(db.bill.create.mock.calls[0][0].data).toMatchObject({
      clientId: "c1",
      enteredById: "u-SALES",
      status: "PENDING",
      amount: "120000.00",
    });
  });

  it("rejects a malformed amount before touching the database", async () => {
    currentActor = as("SALES");
    for (const amount of ["0", "-5", "1.234", "abc", ""]) {
      const response = await bills.POST(
        send("POST", "http://t/api/bills", { ...BILL_BODY, amount }),
        NO_CTX,
      );
      expect(response.status).toBe(422);
    }
    expect(db.bill.create).not.toHaveBeenCalled();
  });
});
