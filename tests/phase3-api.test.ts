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
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  };
}

const MODELS = ["user", "client", "contract", "bill", "commission", "invite", "auditLog", "notification", "notificationPreference"] as const;

/**
 * The transaction client is a *different* object from the top-level client, so a
 * write issued outside the transaction is visible as a call on `db` rather than
 * on `tx` — which is how the "audit inside the transaction" rule is asserted
 * mechanically rather than by reading the code.
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

const billById = await import("@/app/api/bills/[id]/route");
const billVerify = await import("@/app/api/bills/[id]/verify/route");
const billDispute = await import("@/app/api/bills/[id]/dispute/route");
const billVoid = await import("@/app/api/bills/[id]/void/route");
const commissions = await import("@/app/api/commissions/route");
const commissionApprove = await import("@/app/api/commissions/[id]/approve/route");
const commissionPay = await import("@/app/api/commissions/[id]/pay/route");
const batchApprove = await import("@/app/api/commissions/batch-approve/route");

const as = (role: Role): Actor => ({ id: `u-${role}`, role });
const NO_CTX = {} as never;
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const get = (url: string) => new Request(url);
const send = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const decimal = (value: string) => ({ toFixed: (dp: number) => Number(value).toFixed(dp) });

/** A bill as the transition service selects it. */
function billRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1",
    status: "PENDING",
    amount: decimal("120000.00"),
    billNumber: "F-001",
    contractId: "k1",
    contract: { salesOwnerId: "u-SALES", commissionPercentage: decimal("7.50") },
    commission: null,
    ...overrides,
  };
}

function commissionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "cm1",
    status: "PENDING",
    salesUserId: "u-SALES",
    baseAmount: decimal("120000.00"),
    commissionPercentageSnapshot: decimal("7.50"),
    commissionAmount: decimal("9000.00"),
    ...overrides,
  };
}

/** What both services read back through their ROW_SELECT after writing. */
const BILL_ROW = {
  id: "f1",
  billNumber: "F-001",
  amount: decimal("120000.00"),
  currency: "ALL",
  billDate: new Date("2026-09-10T00:00:00Z"),
  status: "VERIFIED",
  client: { id: "c1", name: "Bar Rei" },
  contract: { id: "k1", status: "ACTIVE" },
  enteredBy: { id: "u-SALES", name: "Rep" },
  commission: { id: "cm1", status: "PENDING", commissionAmount: decimal("9000.00") },
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

beforeEach(() => {
  currentActor = null;
  vi.clearAllMocks();
  for (const store of [db, tx]) {
    for (const name of MODELS) {
      store[name].findUnique.mockResolvedValue(null);
      store[name].findFirst.mockResolvedValue(null);
      store[name].findMany.mockResolvedValue([]);
      store[name].count.mockResolvedValue(0);
      store[name].groupBy.mockResolvedValue([]);
      store[name].create.mockResolvedValue({ id: "cm1" });
      store[name].createMany.mockResolvedValue({ count: 0 });
      store[name].update.mockResolvedValue({});
      store[name].updateMany.mockResolvedValue({ count: 1 });
      store[name].delete.mockResolvedValue({});
    }
  }
  db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));

  tx.bill.findFirst.mockResolvedValue(billRecord());
  tx.bill.findUnique.mockResolvedValue(BILL_ROW);
  tx.commission.findUnique.mockResolvedValue(COMMISSION_ROW);
});

const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0];
const auditActions = () => tx.auditLog.create.mock.calls.map((call) => call[0].data.action);

describe("snapshot on verify", () => {
  beforeEach(() => {
    currentActor = as("SUPER_ADMIN");
  });

  it("writes the commission with the contract percentage read in the same call", async () => {
    const response = await billVerify.POST(send("POST", "http://t/verify"), idCtx("f1"));
    expect(response.status).toBe(200);
    expect(lastCall(tx.commission.create).data).toMatchObject({
      billId: "f1",
      contractId: "k1",
      salesUserId: "u-SALES",
      commissionPercentageSnapshot: "7.50",
      baseAmount: "120000.00",
      commissionAmount: "9000.00",
      status: "PENDING",
    });
  });

  it("attributes the commission to the contract owner, never to the caller", async () => {
    await billVerify.POST(send("POST", "http://t/verify"), idCtx("f1"));
    expect(lastCall(tx.commission.create).data.salesUserId).toBe("u-SALES");
    expect(lastCall(tx.commission.create).data.salesUserId).not.toBe("u-SUPER_ADMIN");
  });

  it("moves the bill and creates the commission in one transaction", async () => {
    await billVerify.POST(send("POST", "http://t/verify"), idCtx("f1"));
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(lastCall(tx.bill.updateMany)).toMatchObject({
      where: { id: "f1", status: "PENDING" },
      data: { status: "VERIFIED" },
    });
  });

  it("refuses a second commission for the same bill", async () => {
    tx.bill.findFirst.mockResolvedValue(
      billRecord({ status: "DISPUTED", commission: commissionRecord() }),
    );
    const response = await billVerify.POST(send("POST", "http://t/verify"), idCtx("f1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "COMMISSION_ALREADY_EXISTS" });
    expect(tx.commission.create).not.toHaveBeenCalled();
  });

  it("does not recompute the stored amount when the contract percentage is amended later", async () => {
    // The commission exists at 7.50; the contract has since moved to 9.00.
    tx.commission.findFirst.mockResolvedValue({
      id: "cm1",
      status: "PENDING",
      salesUserId: "u-SALES",
      commissionAmount: decimal("9000.00"),
      bill: { status: "VERIFIED" },
    });
    await commissionApprove.POST(send("POST", "http://t/approve"), idCtx("cm1"));
    expect(lastCall(tx.commission.updateMany).data).toEqual({ status: "APPROVED" });
    expect(lastCall(tx.commission.updateMany).data).not.toHaveProperty("commissionAmount");
  });
});

describe("bill transitions over HTTP", () => {
  beforeEach(() => {
    currentActor = as("SUPER_ADMIN");
  });

  it("refuses a transition out of VOID", async () => {
    tx.bill.findFirst.mockResolvedValue(billRecord({ status: "VOID" }));
    const response = await billVerify.POST(send("POST", "http://t/verify"), idCtx("f1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "TRANSITION_INVALID_TRANSITION" });
    expect(tx.bill.updateMany).not.toHaveBeenCalled();
  });

  it("refuses re-verifying an already verified bill", async () => {
    tx.bill.findFirst.mockResolvedValue(billRecord({ status: "VERIFIED" }));
    const response = await billVerify.POST(send("POST", "http://t/verify"), idCtx("f1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "TRANSITION_SAME_STATUS" });
  });

  it("reverses a pending commission when a verified bill is disputed", async () => {
    tx.bill.findFirst.mockResolvedValue(
      billRecord({ status: "VERIFIED", commission: commissionRecord() }),
    );
    const response = await billDispute.POST(
      send("POST", "http://t/dispute", { reason: "Klienti kontestoi vlerën" }),
      idCtx("f1"),
    );
    expect(response.status).toBe(200);
    expect(tx.commission.delete).toHaveBeenCalledWith({ where: { id: "cm1" } });

    const deleteEntry = tx.auditLog.create.mock.calls
      .map((call) => call[0].data)
      .find((entry) => entry.entityType === "COMMISSION" && entry.action === "DELETE");
    expect(deleteEntry.diff.before).toMatchObject({
      commissionAmount: "9000.00",
      commissionPercentageSnapshot: "7.50",
      status: "PENDING",
    });
    expect(deleteEntry.diff.reason).toBe("Klienti kontestoi vlerën");
  });

  it("refuses to void a bill whose commission is already approved", async () => {
    tx.bill.findFirst.mockResolvedValue(
      billRecord({ status: "VERIFIED", commission: commissionRecord({ status: "APPROVED" }) }),
    );
    const response = await billVoid.POST(send("POST", "http://t/void"), idCtx("f1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "COMMISSION_LOCKED",
      details: { commissionStatus: "APPROVED" },
    });
    expect(tx.commission.delete).not.toHaveBeenCalled();
    expect(tx.bill.updateMany).not.toHaveBeenCalled();
  });

  it("refuses to dispute a bill whose commission is already paid", async () => {
    tx.bill.findFirst.mockResolvedValue(
      billRecord({ status: "VERIFIED", commission: commissionRecord({ status: "PAID" }) }),
    );
    const response = await billDispute.POST(send("POST", "http://t/dispute"), idCtx("f1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "COMMISSION_LOCKED" });
  });

  it("detects a bill that moved underneath the transaction", async () => {
    tx.bill.updateMany.mockResolvedValue({ count: 0 });
    const response = await billVerify.POST(send("POST", "http://t/verify"), idCtx("f1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "BILL_CONCURRENT_MODIFICATION" });
    expect(tx.commission.create).not.toHaveBeenCalled();
  });

  it("reports a bill outside the caller's verification scope as missing", async () => {
    currentActor = as("SALES");
    tx.bill.findFirst.mockResolvedValue(null);
    const response = await billVerify.POST(send("POST", "http://t/verify"), idCtx("f1"));
    expect(response.status).toBe(404);
    expect(lastCall(tx.bill.findFirst).where).toEqual({
      AND: [{ contract: { salesOwnerId: "u-SALES" } }, { id: "f1" }],
    });
  });
});

describe("editing a bill before verification", () => {
  beforeEach(() => {
    currentActor = as("SALES");
    tx.bill.findFirst.mockResolvedValue({
      id: "f1",
      status: "PENDING",
      billNumber: "F-001",
      amount: decimal("120000.00"),
      currency: "ALL",
      billDate: new Date("2026-09-10T00:00:00Z"),
    });
  });

  it("corrects a pending bill and logs only what changed", async () => {
    const response = await billById.PATCH(
      send("PATCH", "http://t/api/bills/f1", { amount: "130000.00" }),
      idCtx("f1"),
    );
    expect(response.status).toBe(200);
    expect(lastCall(tx.bill.updateMany).data).toEqual({ amount: "130000.00" });
    const entry = lastCall(tx.auditLog.create).data;
    expect(entry).toMatchObject({ entityType: "BILL", action: "UPDATE" });
    expect(entry.diff).toEqual({
      before: { amount: "120000.00" },
      after: { amount: "130000.00" },
    });
  });

  it("ignores a contract change smuggled into the body", async () => {
    await billById.PATCH(
      send("PATCH", "http://t/api/bills/f1", { amount: "130000.00", contractId: "k-other" }),
      idCtx("f1"),
    );
    expect(lastCall(tx.bill.updateMany).data).not.toHaveProperty("contractId");
  });

  it("refuses to edit a verified bill", async () => {
    tx.bill.findFirst.mockResolvedValue({
      id: "f1",
      status: "VERIFIED",
      billNumber: "F-001",
      amount: decimal("120000.00"),
      currency: "ALL",
      billDate: new Date("2026-09-10T00:00:00Z"),
    });
    const response = await billById.PATCH(
      send("PATCH", "http://t/api/bills/f1", { amount: "130000.00" }),
      idCtx("f1"),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "BILL_NOT_EDITABLE" });
    expect(tx.bill.updateMany).not.toHaveBeenCalled();
  });
});

describe("commission approval and payment", () => {
  beforeEach(() => {
    currentActor = as("SUPER_ADMIN");
    tx.commission.findFirst.mockResolvedValue({
      id: "cm1",
      status: "PENDING",
      salesUserId: "u-SALES",
      commissionAmount: decimal("9000.00"),
      bill: { status: "VERIFIED" },
    });
  });

  it("approves a pending commission", async () => {
    const response = await commissionApprove.POST(send("POST", "http://t/approve"), idCtx("cm1"));
    expect(response.status).toBe(200);
    expect(lastCall(tx.commission.updateMany)).toMatchObject({
      where: { id: "cm1", status: "PENDING" },
      data: { status: "APPROVED" },
    });
    expect(auditActions()).toEqual(["APPROVE"]);
  });

  it("refuses to approve twice", async () => {
    tx.commission.findFirst.mockResolvedValue({
      id: "cm1",
      status: "APPROVED",
      salesUserId: "u-SALES",
      commissionAmount: decimal("9000.00"),
      bill: { status: "VERIFIED" },
    });
    const response = await commissionApprove.POST(send("POST", "http://t/approve"), idCtx("cm1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "TRANSITION_SAME_STATUS" });
  });

  it("refuses to pay a commission that was never approved", async () => {
    const response = await commissionPay.POST(send("POST", "http://t/pay"), idCtx("cm1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "TRANSITION_INVALID_TRANSITION" });
    expect(tx.commission.updateMany).not.toHaveBeenCalled();
  });

  it("pays an approved commission and records who paid it", async () => {
    tx.commission.findFirst.mockResolvedValue({
      id: "cm1",
      status: "APPROVED",
      salesUserId: "u-SALES",
      commissionAmount: decimal("9000.00"),
      bill: { status: "VERIFIED" },
    });
    const response = await commissionPay.POST(send("POST", "http://t/pay"), idCtx("cm1"));
    expect(response.status).toBe(200);
    const data = lastCall(tx.commission.updateMany).data;
    expect(data.status).toBe("PAID");
    expect(data.paidById).toBe("u-SUPER_ADMIN");
    expect(data.paidAt).toBeInstanceOf(Date);
  });

  it("refuses to approve a commission whose bill is no longer verified", async () => {
    tx.commission.findFirst.mockResolvedValue({
      id: "cm1",
      status: "PENDING",
      salesUserId: "u-SALES",
      commissionAmount: decimal("9000.00"),
      bill: { status: "DISPUTED" },
    });
    const response = await commissionApprove.POST(send("POST", "http://t/approve"), idCtx("cm1"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "BILL_NOT_VERIFIED" });
  });

  it("reports an unknown commission as missing", async () => {
    tx.commission.findFirst.mockResolvedValue(null);
    const response = await commissionApprove.POST(send("POST", "http://t/approve"), idCtx("nope"));
    expect(response.status).toBe(404);
  });
});

describe("batch approval", () => {
  beforeEach(() => {
    currentActor = as("SUPER_ADMIN");
  });

  it("approves the pending ids and reports the rest as skipped", async () => {
    tx.commission.findMany.mockResolvedValue([
      { id: "cm1", salesUserId: "u-SALES", commissionAmount: decimal("9000.00") },
      { id: "cm2", salesUserId: "u-SALES", commissionAmount: decimal("9000.00") },
    ]);
    tx.commission.updateMany.mockResolvedValue({ count: 2 });
    const response = await batchApprove.POST(
      send("POST", "http://t/batch", { ids: ["cm1", "cm2", "cm3"] }),
      NO_CTX,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      approved: 2,
      skipped: [{ id: "cm3", reason: "NOT_PENDING_OR_OUT_OF_SCOPE" }],
    });
    expect(lastCall(tx.auditLog.createMany).data).toHaveLength(2);
  });

  it("writes one audit row per commission, inside the transaction", async () => {
    tx.commission.findMany.mockResolvedValue([{ id: "cm1", salesUserId: "u-SALES", commissionAmount: decimal("9000.00") }]);
    await batchApprove.POST(send("POST", "http://t/batch", { period: "2026-09" }), NO_CTX);
    expect(db.auditLog.createMany).not.toHaveBeenCalled();
    expect(lastCall(tx.auditLog.createMany).data[0]).toMatchObject({
      entityType: "COMMISSION",
      entityId: "cm1",
      action: "APPROVE",
    });
  });

  it("resolves a period against the bill date, in UTC", async () => {
    tx.commission.findMany.mockResolvedValue([]);
    await batchApprove.POST(send("POST", "http://t/batch", { period: "2026-12" }), NO_CTX);
    const where = lastCall(tx.commission.findMany).where;
    expect(where.AND[1]).toEqual({
      bill: { billDate: { gte: new Date("2026-12-01T00:00:00Z"), lt: new Date("2027-01-01T00:00:00Z") } },
    });
  });

  it("refuses a body with no selector at all", async () => {
    const response = await batchApprove.POST(send("POST", "http://t/batch", {}), NO_CTX);
    expect(response.status).toBe(422);
    expect(tx.commission.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a filter match that is too large to approve blind", async () => {
    tx.commission.findMany.mockResolvedValue(
      Array.from({ length: 501 }, (_, index) => ({ id: `cm${index}`, salesUserId: "u-SALES", commissionAmount: decimal("9000.00") })),
    );
    const response = await batchApprove.POST(
      send("POST", "http://t/batch", { period: "2026-09" }),
      NO_CTX,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "BATCH_TOO_LARGE" });
    expect(tx.commission.updateMany).not.toHaveBeenCalled();
  });
});

describe("audit entries land inside the transaction", () => {
  beforeEach(() => {
    currentActor = as("SUPER_ADMIN");
  });

  it("writes a bill entry and a commission entry on verification, both on the tx client", async () => {
    await billVerify.POST(
      send("POST", "http://t/verify", undefined, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
      idCtx("f1"),
    );
    expect(auditActions()).toEqual(["VERIFY", "CREATE"]);
    expect(db.auditLog.create).not.toHaveBeenCalled();
    const entry = tx.auditLog.create.mock.calls[0][0].data;
    expect(entry).toMatchObject({ actorId: "u-SUPER_ADMIN", entityType: "BILL", ipAddress: "203.0.113.7" });
  });

  it("leaves ip_address null when the request carries no forwarding header", async () => {
    await billVerify.POST(send("POST", "http://t/verify"), idCtx("f1"));
    expect(tx.auditLog.create.mock.calls[0][0].data.ipAddress).toBeNull();
  });

  it("writes nothing when the mutation is refused", async () => {
    tx.bill.findFirst.mockResolvedValue(
      billRecord({ status: "VERIFIED", commission: commissionRecord({ status: "PAID" }) }),
    );
    const response = await billVoid.POST(send("POST", "http://t/void"), idCtx("f1"));
    expect(response.status).toBe(409);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("3 roles × 3 endpoints", () => {
  const cases = [
    {
      name: "POST /api/bills/:id/verify",
      call: () => billVerify.POST(send("POST", "http://t/verify"), idCtx("f1")),
      expected: { SUPER_ADMIN: 200, SALES: 200, OUTSIDE_SALES: 403 } as Record<Role, number>,
    },
    {
      name: "POST /api/commissions/:id/approve",
      call: () => commissionApprove.POST(send("POST", "http://t/approve"), idCtx("cm1")),
      expected: { SUPER_ADMIN: 200, SALES: 403, OUTSIDE_SALES: 403 } as Record<Role, number>,
    },
    {
      name: "POST /api/commissions/batch-approve",
      call: () => batchApprove.POST(send("POST", "http://t/batch", { ids: ["cm1"] }), NO_CTX),
      expected: { SUPER_ADMIN: 200, SALES: 403, OUTSIDE_SALES: 403 } as Record<Role, number>,
    },
    {
      name: "GET /api/commissions",
      call: () => commissions.GET(get("http://t/api/commissions"), NO_CTX),
      expected: { SUPER_ADMIN: 200, SALES: 200, OUTSIDE_SALES: 200 } as Record<Role, number>,
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → 401 without a session`, async () => {
      const response = await testCase.call();
      expect(response.status).toBe(401);
    });

    for (const role of ROLES) {
      it(`${testCase.name} · ${role} → ${testCase.expected[role]}`, async () => {
        currentActor = as(role);
        tx.bill.findFirst.mockResolvedValue(
          billRecord({ contract: { salesOwnerId: `u-${role}`, commissionPercentage: decimal("7.50") } }),
        );
        tx.commission.findFirst.mockResolvedValue({
          id: "cm1",
          status: "PENDING",
          salesUserId: "u-SALES",
          commissionAmount: decimal("9000.00"),
          bill: { status: "VERIFIED" },
        });
        tx.commission.findMany.mockResolvedValue([{ id: "cm1", salesUserId: `u-${role}`, commissionAmount: decimal("9000.00") }]);
        const response = await testCase.call();
        expect(response.status).toBe(testCase.expected[role]);
      });
    }
  }

  it("a rep who does not own the contract gets 404 rather than 403", async () => {
    currentActor = as("SALES");
    tx.bill.findFirst.mockResolvedValue(null);
    const response = await billVerify.POST(send("POST", "http://t/verify"), idCtx("f1"));
    expect(response.status).toBe(404);
  });
});

describe("commission list scoping happens in the query", () => {
  it("a Super Admin sees every payout", async () => {
    currentActor = as("SUPER_ADMIN");
    await commissions.GET(get("http://t/api/commissions"), NO_CTX);
    expect(lastCall(db.commission.findMany).where).toEqual({ AND: [{}, {}] });
  });

  it("a rep sees only their own", async () => {
    currentActor = as("SALES");
    await commissions.GET(get("http://t/api/commissions"), NO_CTX);
    expect(lastCall(db.commission.findMany).where).toEqual({
      AND: [{ salesUserId: "u-SALES" }, {}],
    });
  });

  it("a salesUserId parameter cannot widen a rep's scope", async () => {
    currentActor = as("OUTSIDE_SALES");
    await commissions.GET(get("http://t/api/commissions?salesUserId=u-SALES"), NO_CTX);
    expect(lastCall(db.commission.findMany).where).toEqual({
      AND: [{ salesUserId: "u-OUTSIDE_SALES" }, { salesUserId: "u-SALES" }],
    });
  });

  it("filters a period against the bill date", async () => {
    currentActor = as("SUPER_ADMIN");
    await commissions.GET(get("http://t/api/commissions?period=2026-09"), NO_CTX);
    expect(lastCall(db.commission.findMany).where.AND[1]).toEqual({
      bill: { billDate: { gte: new Date("2026-09-01T00:00:00Z"), lt: new Date("2026-10-01T00:00:00Z") } },
    });
  });

  it("rejects a malformed period and a sort field that is not allowlisted", async () => {
    currentActor = as("SUPER_ADMIN");
    expect((await commissions.GET(get("http://t/api/commissions?period=2026-13"), NO_CTX)).status).toBe(422);
    expect((await commissions.GET(get("http://t/api/commissions?sort=paidById:asc"), NO_CTX)).status).toBe(422);
    expect(db.commission.findMany).not.toHaveBeenCalled();
  });

  it("paginates server-side", async () => {
    currentActor = as("SUPER_ADMIN");
    await commissions.GET(get("http://t/api/commissions?page=2&pageSize=10"), NO_CTX);
    expect(lastCall(db.commission.findMany)).toMatchObject({ skip: 10, take: 10 });
  });
});
