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

/** The queue is the one thing these handlers touch outside Postgres. */
const enqueueNotificationEmails = vi.fn(async () => {});
vi.mock("@/lib/jobs/queue", () => ({
  QUEUES: {
    notificationEmail: "notifications.email",
    contractSweep: "contracts.daily-sweep",
    summaryRollup: "summaries.nightly-rollup",
  },
  enqueue: vi.fn(async () => null),
  enqueueNotificationEmails,
  createBoss: vi.fn(),
  stopQueue: vi.fn(async () => {}),
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
    upsert: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  };
}

const MODELS = [
  "user",
  "client",
  "contract",
  "bill",
  "commission",
  "invite",
  "auditLog",
  "notification",
  "notificationPreference",
] as const;

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
  $queryRawUnsafe: vi.fn(),
};

vi.mock("@/lib/db", () => ({ prisma: db }));

const renew = await import("@/app/api/contracts/[id]/renew/route");
const terminate = await import("@/app/api/contracts/[id]/terminate/route");
const notifications = await import("@/app/api/notifications/route");
const notificationRead = await import("@/app/api/notifications/[id]/read/route");
const commissions = await import("@/app/api/commissions/route");
const commissionApprove = await import("@/app/api/commissions/[id]/approve/route");
const billDispute = await import("@/app/api/bills/[id]/dispute/route");

const as = (role: Role): Actor => ({ id: `u-${role}`, role });
const NO_CTX = {} as never;
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url: string) => new Request(url);
const send = (url: string, body?: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const patch = (url: string) => new Request(url, { method: "PATCH" });

const decimal = (value: string) => ({ toFixed: (dp: number) => Number(value).toFixed(dp) });
const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0];

/** A contract as the renew/terminate services select it. */
function contractRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "k1",
    status: "ACTIVE",
    clientId: "c1",
    salesOwnerId: "u-SALES",
    commissionPercentage: decimal("7.50"),
    endDate: new Date("2026-12-31T00:00:00Z"),
    paymentTerms: "30 ditë",
    notes: null,
    renewedInto: null,
    ...overrides,
  };
}

/** What both services read back through ROW_SELECT. */
const CONTRACT_ROW = {
  id: "k1",
  status: "RENEWED",
  commissionPercentage: decimal("7.50"),
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2026-12-31T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  client: { id: "c1", name: "Bar Rei" },
  salesOwner: { id: "u-SALES", name: "Rep" },
};

const NOTIFICATION_ROW = {
  id: "n1",
  type: "COMMISSION_APPROVED",
  title: "Komisioni u aprovua",
  body: "Komisioni prej 9000.00 u aprovua dhe pret pagesën.",
  readAt: null,
  entityType: "COMMISSION",
  entityId: "cm1",
  createdAt: new Date("2026-09-17T10:00:00Z"),
};

const COMMISSION_ROW = {
  id: "cm1",
  status: "APPROVED",
  baseAmount: decimal("120000.00"),
  commissionPercentageSnapshot: decimal("7.50"),
  commissionAmount: decimal("9000.00"),
  createdAt: new Date("2026-09-17T00:00:00Z"),
  paidAt: null,
  salesUser: { id: "u-SALES", name: "Rep" },
  contract: { id: "k1" },
  bill: {
    id: "f1",
    billNumber: "F-001",
    billDate: new Date("2026-09-10T00:00:00Z"),
    status: "VERIFIED",
    client: { id: "c1", name: "Bar Rei" },
  },
};

const RENEW_BODY = { startDate: "2027-01-01", endDate: "2027-12-31" };
const TERMINATE_BODY = { reason: "Klienti mbylli lokalin" };

beforeEach(() => {
  currentActor = null;
  vi.clearAllMocks();
  for (const store of [tx, db]) {
    for (const key of MODELS) {
      store[key].findUnique.mockResolvedValue(null);
      store[key].findFirst.mockResolvedValue(null);
      store[key].findMany.mockResolvedValue([]);
      store[key].count.mockResolvedValue(0);
      store[key].groupBy.mockResolvedValue([]);
      store[key].updateMany.mockResolvedValue({ count: 1 });
    }
  }
  db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  db.$queryRawUnsafe.mockResolvedValue([]);

  tx.contract.findFirst.mockResolvedValue(contractRecord());
  tx.contract.create.mockResolvedValue({ id: "k2" });
  tx.contract.update.mockResolvedValue(CONTRACT_ROW);
  tx.contract.findUnique.mockResolvedValue({ ...CONTRACT_ROW, status: "TERMINATED" });
  tx.notification.create.mockResolvedValue({ id: "n1" });
  db.notification.findFirst.mockResolvedValue(NOTIFICATION_ROW);
  db.notification.findMany.mockResolvedValue([NOTIFICATION_ROW]);
  db.commission.findMany.mockResolvedValue([COMMISSION_ROW]);
});

const auditEntries = () => tx.auditLog.create.mock.calls.map((call) => call[0].data);

describe("contract renewal", () => {
  beforeEach(() => {
    currentActor = as("SUPER_ADMIN");
  });

  it("closes the old contract and links the new one, in one transaction", async () => {
    const response = await renew.POST(send("http://t/renew", RENEW_BODY), idCtx("k1"));
    expect(response.status).toBe(201);

    const created = lastCall(tx.contract.create).data;
    expect(created.previousContractId).toBe("k1");
    expect(created.status).toBe("DRAFT");
    // The successor inherits the terms it was not given.
    expect(created.commissionPercentage).toBe("7.50");
    expect(created.paymentTerms).toBe("30 ditë");

    const updates = tx.contract.update.mock.calls.map((call) => call[0]);
    expect(updates).toEqual([
      { where: { id: "k2" }, data: { status: "ACTIVE" }, select: expect.anything() },
      { where: { id: "k1" }, data: { status: "RENEWED" }, select: expect.anything() },
    ]);
    // One transaction, so a client is never left with two ACTIVE contracts.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("writes the successor's creation, its activation and the closure", async () => {
    await renew.POST(send("http://t/renew", RENEW_BODY), idCtx("k1"));
    expect(auditEntries().map((entry) => [entry.entityId, entry.action])).toEqual([
      ["k2", "CREATE"],
      ["k2", "STATUS_CHANGE"],
      ["k1", "STATUS_CHANGE"],
    ]);
    const closure = auditEntries().at(-1);
    expect(closure.diff).toMatchObject({
      before: { status: "ACTIVE" },
      after: { status: "RENEWED" },
      renewedIntoId: "k2",
    });
  });

  it("refuses to renew a contract that is not ACTIVE", async () => {
    tx.contract.findFirst.mockResolvedValue(contractRecord({ status: "DRAFT" }));
    const response = await renew.POST(send("http://t/renew", RENEW_BODY), idCtx("k1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "TRANSITION_INVALID_TRANSITION" });
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("refuses a second renewal of the same contract", async () => {
    tx.contract.findFirst.mockResolvedValue(contractRecord({ renewedInto: { id: "k9" } }));
    const response = await renew.POST(send("http://t/renew", RENEW_BODY), idCtx("k1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "ALREADY_RENEWED" });
  });

  it("lets a Super Admin change the percentage on renewal", async () => {
    await renew.POST(
      send("http://t/renew", { ...RENEW_BODY, commissionPercentage: "9.00" }),
      idCtx("k1"),
    );
    expect(lastCall(tx.contract.create).data.commissionPercentage).toBe("9.00");
  });

  it("refuses a percentage change by a rep, while allowing the same value", async () => {
    currentActor = as("SALES");

    const changed = await renew.POST(
      send("http://t/renew", { ...RENEW_BODY, commissionPercentage: "9.00" }),
      idCtx("k1"),
    );
    expect(changed.status).toBe(403);
    expect(await changed.json()).toMatchObject({ error: "COMMISSION_EDIT_FORBIDDEN" });

    // Echoing the contract's own percentage is not an amendment.
    const unchanged = await renew.POST(
      send("http://t/renew", { ...RENEW_BODY, commissionPercentage: "7.50" }),
      idCtx("k1"),
    );
    expect(unchanged.status).toBe(201);
  });

  it("scopes a rep to the contracts they own", async () => {
    currentActor = as("SALES");
    await renew.POST(send("http://t/renew", RENEW_BODY), idCtx("k1"));
    expect(lastCall(tx.contract.findFirst).where).toEqual({
      AND: [{ salesOwnerId: "u-SALES" }, { id: "k1" }],
    });
  });

  it("rejects an end date before the start date", async () => {
    const response = await renew.POST(
      send("http://t/renew", { startDate: "2027-06-01", endDate: "2027-01-01" }),
      idCtx("k1"),
    );
    expect(response.status).toBe(422);
  });
});

describe("contract termination", () => {
  beforeEach(() => {
    currentActor = as("SUPER_ADMIN");
  });

  it("requires a reason and keeps it in the audit entry", async () => {
    const response = await terminate.POST(send("http://t/terminate", TERMINATE_BODY), idCtx("k1"));
    expect(response.status).toBe(200);
    expect(lastCall(tx.contract.updateMany)).toMatchObject({
      where: { id: "k1", status: "ACTIVE" },
      data: { status: "TERMINATED" },
    });
    expect(auditEntries()).toHaveLength(1);
    expect(auditEntries()[0].diff).toMatchObject({
      before: { status: "ACTIVE" },
      after: { status: "TERMINATED" },
      reason: "Klienti mbylli lokalin",
    });
  });

  it("refuses to terminate without a reason", async () => {
    const response = await terminate.POST(send("http://t/terminate", {}), idCtx("k1"));
    expect(response.status).toBe(422);
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to terminate a contract that already left ACTIVE", async () => {
    tx.contract.findFirst.mockResolvedValue(contractRecord({ status: "EXPIRED" }));
    const response = await terminate.POST(send("http://t/terminate", TERMINATE_BODY), idCtx("k1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "TRANSITION_INVALID_TRANSITION" });
  });

  it("detects a contract that moved underneath the transaction", async () => {
    tx.contract.updateMany.mockResolvedValue({ count: 0 });
    const response = await terminate.POST(send("http://t/terminate", TERMINATE_BODY), idCtx("k1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "CONTRACT_CONCURRENT_MODIFICATION" });
  });

  it("reports a contract outside the caller's scope as missing", async () => {
    currentActor = as("SALES");
    tx.contract.findFirst.mockResolvedValue(null);
    const response = await terminate.POST(send("http://t/terminate", TERMINATE_BODY), idCtx("k1"));
    expect(response.status).toBe(404);
  });
});

describe("notifications", () => {
  it("shows every role only their own feed", async () => {
    for (const role of ROLES) {
      currentActor = as(role);
      await notifications.GET(get("http://t/api/notifications"), NO_CTX);
      expect(lastCall(db.notification.findMany).where).toEqual({
        AND: [{ userId: `u-${role}` }, {}],
      });
    }
  });

  it("filters unread and counts them separately from the page", async () => {
    currentActor = as("SALES");
    db.notification.count.mockResolvedValue(3);
    const response = await notifications.GET(
      get("http://t/api/notifications?unread=true"),
      NO_CTX,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ unread: 3 });
    expect(lastCall(db.notification.findMany).where).toEqual({
      AND: [{ userId: "u-SALES" }, { readAt: null }],
    });
  });

  it("marks one as read, scoped to its owner", async () => {
    currentActor = as("SALES");
    const response = await notificationRead.PATCH(patch("http://t/read"), idCtx("n1"));
    expect(response.status).toBe(200);
    expect(lastCall(db.notification.updateMany)).toMatchObject({
      where: { id: "n1", userId: "u-SALES", readAt: null },
    });
  });

  it("is idempotent on an already-read notification", async () => {
    currentActor = as("SALES");
    db.notification.findFirst.mockResolvedValue({
      ...NOTIFICATION_ROW,
      readAt: new Date("2026-09-17T12:00:00Z"),
    });
    const response = await notificationRead.PATCH(patch("http://t/read"), idCtx("n1"));
    expect(response.status).toBe(200);
    expect(db.notification.updateMany).not.toHaveBeenCalled();
  });

  it("reports somebody else's notification as missing, not forbidden", async () => {
    currentActor = as("SUPER_ADMIN");
    db.notification.findFirst.mockResolvedValue(null);
    const response = await notificationRead.PATCH(patch("http://t/read"), idCtx("n1"));
    expect(response.status).toBe(404);
  });
});

describe("commission statement CSV", () => {
  it("returns a CSV attachment for the same filters as the list", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await commissions.GET(
      get("http://t/api/commissions?format=csv&period=2026-09"),
      NO_CTX,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("komisione-2026-09.csv");

    // The BOM has to be checked on the bytes: decoding a Response strips it, and
    // Excel is the reader that needs it.
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const body = await response.text();
    expect(body).toContain("Nr. faturës");
    expect(body).toContain("F-001");
    expect(body).toContain("9000.00");
  });

  it("exports without a page window, but with a cap", async () => {
    currentActor = as("SUPER_ADMIN");
    await commissions.GET(get("http://t/api/commissions?format=csv"), NO_CTX);
    const call = lastCall(db.commission.findMany);
    expect(call.skip).toBeUndefined();
    expect(call.take).toBe(5001);
  });

  it("keeps a rep's own scope in the export", async () => {
    currentActor = as("OUTSIDE_SALES");
    await commissions.GET(get("http://t/api/commissions?format=csv"), NO_CTX);
    expect(lastCall(db.commission.findMany).where).toEqual({
      AND: [{ salesUserId: "u-OUTSIDE_SALES" }, {}],
    });
  });

  it("still answers JSON without the format parameter", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await commissions.GET(get("http://t/api/commissions"), NO_CTX);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe("notifications raised by a money mutation", () => {
  beforeEach(() => {
    currentActor = as("SUPER_ADMIN");
  });

  it("tells the rep when their commission is approved, in the same transaction", async () => {
    tx.commission.findFirst.mockResolvedValue({
      id: "cm1",
      status: "PENDING",
      salesUserId: "u-SALES",
      commissionAmount: decimal("9000.00"),
      bill: { status: "VERIFIED" },
    });
    tx.commission.findUnique.mockResolvedValue(COMMISSION_ROW);

    const response = await commissionApprove.POST(send("http://t/approve"), idCtx("cm1"));
    expect(response.status).toBe(200);

    const draft = lastCall(tx.notification.create).data;
    expect(draft).toMatchObject({
      userId: "u-SALES",
      type: "COMMISSION_APPROVED",
      entityType: "COMMISSION",
      entityId: "cm1",
    });
    expect(draft.body).toContain("9000.00");
    // Email leaves the transaction as an id, never as an SMTP call inside it.
    expect(enqueueNotificationEmails).toHaveBeenCalledWith(["n1"]);
  });

  it("writes nothing when the transition is refused", async () => {
    tx.commission.findFirst.mockResolvedValue({
      id: "cm1",
      status: "APPROVED",
      salesUserId: "u-SALES",
      commissionAmount: decimal("9000.00"),
      bill: { status: "VERIFIED" },
    });
    const response = await commissionApprove.POST(send("http://t/approve"), idCtx("cm1"));
    expect(response.status).toBe(409);
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(enqueueNotificationEmails).not.toHaveBeenCalled();
  });

  it("tells the contract owner when a bill of theirs is disputed", async () => {
    tx.bill.findFirst.mockResolvedValue({
      id: "f1",
      status: "VERIFIED",
      amount: decimal("120000.00"),
      billNumber: "F-001",
      contractId: "k1",
      contract: { salesOwnerId: "u-SALES", commissionPercentage: decimal("7.50") },
      commission: {
        id: "cm1",
        status: "PENDING",
        salesUserId: "u-SALES",
        baseAmount: decimal("120000.00"),
        commissionPercentageSnapshot: decimal("7.50"),
        commissionAmount: decimal("9000.00"),
      },
    });
    tx.bill.findUnique.mockResolvedValue({
      id: "f1",
      billNumber: "F-001",
      amount: decimal("120000.00"),
      currency: "ALL",
      billDate: new Date("2026-09-10T00:00:00Z"),
      status: "DISPUTED",
      client: { id: "c1", name: "Bar Rei" },
      contract: { id: "k1", status: "ACTIVE" },
      enteredBy: { id: "u-SALES", name: "Rep" },
      commission: null,
    });

    const response = await billDispute.POST(
      send("http://t/dispute", { reason: "Klienti kontestoi vlerën" }),
      idCtx("f1"),
    );
    expect(response.status).toBe(200);
    const draft = lastCall(tx.notification.create).data;
    expect(draft).toMatchObject({ userId: "u-SALES", type: "BILL_DISPUTED", entityId: "f1" });
    expect(draft.body).toContain("Klienti kontestoi vlerën");
  });
});

describe("3 roles × 3 endpoints", () => {
  const cases = [
    {
      name: "POST /api/contracts/:id/renew",
      call: () => renew.POST(send("http://t/renew", RENEW_BODY), idCtx("k1")),
      expected: { SUPER_ADMIN: 201, SALES: 201, OUTSIDE_SALES: 403 },
    },
    {
      name: "POST /api/contracts/:id/terminate",
      call: () => terminate.POST(send("http://t/terminate", TERMINATE_BODY), idCtx("k1")),
      expected: { SUPER_ADMIN: 200, SALES: 200, OUTSIDE_SALES: 403 },
    },
    {
      name: "GET /api/notifications",
      call: () => notifications.GET(get("http://t/api/notifications"), NO_CTX),
      expected: { SUPER_ADMIN: 200, SALES: 200, OUTSIDE_SALES: 200 },
    },
  ] satisfies Array<{ name: string; call: () => Promise<Response>; expected: Record<Role, number> }>;

  for (const testCase of cases) {
    it(`${testCase.name} → 401 without a session`, async () => {
      currentActor = null;
      expect((await testCase.call()).status).toBe(401);
    });

    for (const role of ROLES) {
      it(`${testCase.name} · ${role} → ${testCase.expected[role]}`, async () => {
        currentActor = as(role);
        tx.contract.findFirst.mockResolvedValue(contractRecord({ salesOwnerId: `u-${role}` }));
        expect((await testCase.call()).status).toBe(testCase.expected[role]);
      });
    }
  }

  it("never lets Outside Sales reach the renewal or termination service", async () => {
    currentActor = as("OUTSIDE_SALES");
    await renew.POST(send("http://t/renew", RENEW_BODY), idCtx("k1"));
    await terminate.POST(send("http://t/terminate", TERMINATE_BODY), idCtx("k1"));
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
