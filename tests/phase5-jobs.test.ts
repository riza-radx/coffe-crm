import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftCron } from "@/lib/jobs/cron";

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

const MODELS = ["user", "contract", "bill", "commission", "auditLog", "notification", "notificationPreference", "revenueSummary"] as const;

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

const { sweepContracts, startOfUtcDay, addDays } = await import("@/lib/jobs/contract-sweep");
const { rollupMonth, monthsToRoll, ROLLUP_GROUP_LIMIT } = await import("@/lib/jobs/rollup");
const { buildRevenueGroupSql } = await import("@/lib/queries/analytics-sql");

const NOW = new Date("2026-09-17T03:15:00Z");
const decimal = (value: string) => ({ toFixed: (dp: number) => Number(value).toFixed(dp) });
const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0];

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: "k1",
    status: "ACTIVE",
    endDate: new Date("2026-09-10T00:00:00Z"),
    salesOwnerId: "u-SALES",
    client: { name: "Bar Rei" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const store of [tx, db]) {
    for (const key of MODELS) {
      store[key].findMany.mockResolvedValue([]);
      store[key].findUnique.mockResolvedValue(null);
      store[key].count.mockResolvedValue(0);
      store[key].groupBy.mockResolvedValue([]);
      store[key].updateMany.mockResolvedValue({ count: 1 });
    }
  }
  db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  db.$queryRawUnsafe.mockResolvedValue([]);
  tx.notification.create.mockResolvedValue({ id: "n1" });
});

describe("daily contract sweep", () => {
  it("expires a contract whose end date has passed, as the system and not a person", async () => {
    db.contract.findMany.mockResolvedValueOnce([contract()]).mockResolvedValueOnce([]);

    const result = await sweepContracts(NOW);

    expect(result.expired).toEqual(["k1"]);
    expect(lastCall(tx.contract.updateMany)).toMatchObject({
      where: { id: "k1", status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });

    const entry = lastCall(tx.auditLog.create).data;
    expect(entry.actorId).toBeNull();
    expect(entry.action).toBe("STATUS_CHANGE");
    expect(entry.diff).toMatchObject({
      before: { status: "ACTIVE" },
      after: { status: "EXPIRED" },
      reason: "END_DATE_PASSED",
    });
  });

  it("only looks at ACTIVE contracts with a date in the past", async () => {
    await sweepContracts(NOW);
    const [due, upcoming] = db.contract.findMany.mock.calls.map((call) => call[0].where);
    expect(due).toEqual({ status: "ACTIVE", endDate: { not: null, lt: startOfUtcDay(NOW) } });
    expect(upcoming).toEqual({
      status: "ACTIVE",
      endDate: { gte: startOfUtcDay(NOW), lte: addDays(startOfUtcDay(NOW), 30) },
    });
  });

  it("leaves a contract alone when somebody moved it first", async () => {
    db.contract.findMany.mockResolvedValueOnce([contract()]).mockResolvedValueOnce([]);
    tx.contract.updateMany.mockResolvedValue({ count: 0 });

    const result = await sweepContracts(NOW);

    expect(result.expired).toEqual([]);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it("notifies the owner once per warning window", async () => {
    const soon = contract({ id: "k2", endDate: new Date("2026-10-01T00:00:00Z") });
    db.contract.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([soon]);

    const first = await sweepContracts(NOW);
    expect(first.warned).toEqual(["k2"]);
    const draft = lastCall(tx.notification.create).data;
    expect(draft).toMatchObject({ userId: "u-SALES", type: "CONTRACT_EXPIRING", entityId: "k2" });
    expect(draft.title).toContain("Bar Rei");

    // The sweep runs again tomorrow over the same contract.
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
    db.contract.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([soon]);
    db.notification.count.mockResolvedValue(1);

    const second = await sweepContracts(addDays(NOW, 1));
    expect(second.warned).toEqual([]);
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it("hands the email ids back instead of sending inside the transaction", async () => {
    db.contract.findMany.mockResolvedValueOnce([contract()]).mockResolvedValueOnce([]);
    const result = await sweepContracts(NOW);
    expect(result.emails).toEqual(["n1"]);
  });
});

describe("nightly rollup", () => {
  it("rolls the current month and the one before it", () => {
    expect(monthsToRoll(new Date("2026-09-17T03:15:00Z"))).toEqual(["2026-08", "2026-09"]);
    // A January run reaches back into the previous year.
    expect(monthsToRoll(new Date("2026-01-05T03:15:00Z"))).toEqual(["2025-12", "2026-01"]);
  });

  it("aggregates with the same SQL the live analytics use", async () => {
    await rollupMonth("2026-09");

    const expected = buildRevenueGroupSql({
      groupBy: "client",
      range: { gte: new Date(Date.UTC(2026, 8, 1)), lt: new Date(Date.UTC(2026, 9, 1)) },
      ownerId: null,
      limit: ROLLUP_GROUP_LIMIT,
    });
    const statements = db.$queryRawUnsafe.mock.calls.map((call) => call[0]);
    expect(statements[0]).toBe(expected.text);
    // Unscoped: the rollup is the whole business, and reading it is scoped later.
    expect(statements[0]).not.toContain("sales_owner_id =");
    expect(statements[1]).toContain("c.sales_owner_id AS key");
  });

  it("upserts one row per client and per rep", async () => {
    db.$queryRawUnsafe
      .mockResolvedValueOnce([{ key: "c1", revenue: "120000.00", bill_count: 2 }])
      .mockResolvedValueOnce([{ key: "u-SALES", revenue: "120000.00", bill_count: 2 }]);
    db.commission.groupBy.mockResolvedValue([
      { salesUserId: "u-SALES", _sum: { commissionAmount: decimal("9000.00") }, _count: { _all: 2 } },
    ]);

    const result = await rollupMonth("2026-09");
    expect(result).toEqual({ month: "2026-09", clients: 1, reps: 1 });

    const upserts = tx.revenueSummary.upsert.mock.calls.map((call) => call[0]);
    expect(upserts[0].where.grain_subjectId_periodMonth).toEqual({
      grain: "CLIENT",
      subjectId: "c1",
      periodMonth: new Date(Date.UTC(2026, 8, 1)),
    });
    expect(upserts[0].create.commissionAmount).toBeUndefined();
    expect(upserts[1].create).toMatchObject({
      grain: "SALES_REP",
      subjectId: "u-SALES",
      revenue: "120000.00",
      commissionAmount: "9000.00",
      commissionCount: 2,
    });
  });

  it("keeps a rep whose bills were all voided but who has commissions on record", async () => {
    db.$queryRawUnsafe.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    db.commission.groupBy.mockResolvedValue([
      { salesUserId: "u-GHOST", _sum: { commissionAmount: decimal("500.00") }, _count: { _all: 1 } },
    ]);

    const result = await rollupMonth("2026-09");
    expect(result.reps).toBe(1);
    expect(lastCall(tx.revenueSummary.upsert).create).toMatchObject({
      subjectId: "u-GHOST",
      revenue: "0",
      billCount: 0,
      commissionAmount: "500.00",
    });
  });

  it("writes every month's rows in one transaction", async () => {
    db.$queryRawUnsafe
      .mockResolvedValueOnce([{ key: "c1", revenue: "1.00", bill_count: 1 }])
      .mockResolvedValueOnce([{ key: "u1", revenue: "1.00", bill_count: 1 }]);
    await rollupMonth("2026-09");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("cron shifting", () => {
  it("moves the minute", () => {
    expect(shiftCron("15 2 * * *", 15)).toBe("30 2 * * *");
  });

  it("carries into the next hour, and around midnight", () => {
    expect(shiftCron("50 2 * * *", 15)).toBe("5 3 * * *");
    expect(shiftCron("50 23 * * *", 15)).toBe("5 0 * * *");
  });

  it("returns anything it does not understand unchanged", () => {
    for (const cron of ["*/5 * * * *", "0 2 * * 1-5 extra", "@daily"]) {
      expect(shiftCron(cron, 15)).toBe(cron);
    }
  });
});
