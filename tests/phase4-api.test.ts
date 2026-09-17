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

const db = {
  ...(Object.fromEntries(MODELS.map((name) => [name, model()])) as Record<
    (typeof MODELS)[number],
    ReturnType<typeof model>
  >),
  $transaction: vi.fn(),
  $queryRawUnsafe: vi.fn(),
};

vi.mock("@/lib/db", () => ({ prisma: db }));

const leaderboard = await import("@/app/api/analytics/leaderboard/route");
const revenue = await import("@/app/api/analytics/revenue/route");
const summary = await import("@/app/api/analytics/commissions/summary/route");
const auditLogs = await import("@/app/api/audit-logs/route");

const as = (role: Role): Actor => ({ id: `u-${role}`, role });
const NO_CTX = {} as never;
const get = (url: string) => new Request(url);
const decimal = (value: string) => ({ toFixed: (dp: number) => Number(value).toFixed(dp) });

/** Three reps, so a redacted response has something to leak if it is going to. */
const REPS = [
  { id: "u-SUPER_ADMIN", name: "Admin Rei" },
  { id: "u-SALES", name: "Erjon Brendi" },
  { id: "u-OUTSIDE_SALES", name: "Blerta Jashtme" },
];

const REVENUE_BY_REP = [
  { key: "u-SALES", revenue: "900000.00", bill_count: 9 },
  { key: "u-SUPER_ADMIN", revenue: "500000.00", bill_count: 5 },
  { key: "u-OUTSIDE_SALES", revenue: "100000.00", bill_count: 1 },
];

const COMMISSIONS_BY_REP = [
  { salesUserId: "u-SALES", _sum: { commissionAmount: decimal("67500.00") }, _count: { _all: 9 } },
  { salesUserId: "u-SUPER_ADMIN", _sum: { commissionAmount: decimal("37500.00") }, _count: { _all: 5 } },
  { salesUserId: "u-OUTSIDE_SALES", _sum: { commissionAmount: decimal("7500.00") }, _count: { _all: 1 } },
];

beforeEach(() => {
  currentActor = null;
  vi.clearAllMocks();
  for (const key of MODELS) {
    db[key].findUnique.mockResolvedValue(null);
    db[key].findFirst.mockResolvedValue(null);
    db[key].findMany.mockResolvedValue([]);
    db[key].count.mockResolvedValue(0);
    db[key].groupBy.mockResolvedValue([]);
  }
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  db.$queryRawUnsafe.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue(REPS);
});

/** The leaderboard reads revenue per rep, then the grand total is never asked for. */
function leaderboardStore() {
  db.$queryRawUnsafe.mockResolvedValue(REVENUE_BY_REP);
  db.commission.groupBy.mockResolvedValue(COMMISSIONS_BY_REP);
}

const LEADERBOARD_URL = "http://t/api/analytics/leaderboard?period=2026-09";
const REVENUE_URL = "http://t/api/analytics/revenue?groupBy=client&from=2026-01-01&to=2026-09-30";

describe("3 roles x 3 endpoints — reachability", () => {
  const cases = [
    { name: "GET /api/analytics/leaderboard", call: () => leaderboard.GET(get(LEADERBOARD_URL), NO_CTX) },
    { name: "GET /api/analytics/revenue", call: () => revenue.GET(get(REVENUE_URL), NO_CTX) },
    {
      name: "GET /api/analytics/commissions/summary",
      call: () => summary.GET(get("http://t/api/analytics/commissions/summary"), NO_CTX),
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → 401 without a session`, async () => {
      expect((await testCase.call()).status).toBe(401);
    });

    for (const role of ROLES) {
      it(`${testCase.name} · ${role} → 200`, async () => {
        currentActor = as(role);
        leaderboardStore();
        expect((await testCase.call()).status).toBe(200);
      });
    }
  }

  // The audit log is the one endpoint of this phase that is not for everyone.
  const auditExpected: Record<Role, number> = { SUPER_ADMIN: 200, SALES: 403, OUTSIDE_SALES: 403 };
  it("GET /api/audit-logs → 401 without a session", async () => {
    expect((await auditLogs.GET(get("http://t/api/audit-logs"), NO_CTX)).status).toBe(401);
  });
  for (const role of ROLES) {
    it(`GET /api/audit-logs · ${role} → ${auditExpected[role]}`, async () => {
      currentActor = as(role);
      const response = await auditLogs.GET(get("http://t/api/audit-logs"), NO_CTX);
      expect(response.status).toBe(auditExpected[role]);
      if (auditExpected[role] !== 200) expect(db.auditLog.findMany).not.toHaveBeenCalled();
    });
  }
});

describe("leaderboard: who sees whom", () => {
  beforeEach(leaderboardStore);

  it("Super Admin sees the whole board, ranked by revenue", async () => {
    currentActor = as("SUPER_ADMIN");
    const body = await (await leaderboard.GET(get(LEADERBOARD_URL), NO_CTX)).json();
    expect(body.scope).toBe("all");
    expect(body.rows.map((r: { salesUser: { id: string } }) => r.salesUser.id)).toEqual([
      "u-SALES",
      "u-SUPER_ADMIN",
      "u-OUTSIDE_SALES",
    ]);
    expect(body.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3]);
    expect(body.totalReps).toBe(3);
  });

  /**
   * Internal Sales is "own"-scoped for `viewAll:commission` — the permission the
   * route gate uses. That scope governs the payout list, not the board, and this
   * pins the two apart.
   */
  it("internal Sales sees the whole board too", async () => {
    currentActor = as("SALES");
    const body = await (await leaderboard.GET(get(LEADERBOARD_URL), NO_CTX)).json();
    expect(body.scope).toBe("all");
    expect(body.rows).toHaveLength(3);
  });

  it("Outside Sales gets one row, a rank, and nobody else's name or numbers", async () => {
    currentActor = as("OUTSIDE_SALES");
    const response = await leaderboard.GET(get(LEADERBOARD_URL), NO_CTX);
    const body = await response.json();

    expect(body.scope).toBe("own");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].salesUser.id).toBe("u-OUTSIDE_SALES");
    expect(body.self).toEqual({ rank: 3, of: 3 });
    expect(body.totalReps).toBe(3);

    // The assertion that survives a refactor adding a field: nothing belonging to
    // another rep appears anywhere in the serialized payload.
    const serialized = JSON.stringify(body);
    for (const leak of ["u-SALES", "u-SUPER_ADMIN", "Erjon Brendi", "Admin Rei", "900000", "67500"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("an Outside Sales rep with no activity gets a zero row and no rank", async () => {
    currentActor = as("OUTSIDE_SALES");
    db.$queryRawUnsafe.mockResolvedValue(REVENUE_BY_REP.filter((r) => r.key !== "u-OUTSIDE_SALES"));
    db.commission.groupBy.mockResolvedValue(
      COMMISSIONS_BY_REP.filter((c) => c.salesUserId !== "u-OUTSIDE_SALES"),
    );

    const body = await (await leaderboard.GET(get(LEADERBOARD_URL), NO_CTX)).json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].revenue).toBe("0.00");
    expect(body.rows[0].commission).toBe("0.00");
    expect(body.self).toBeNull();
    expect(body.totalReps).toBe(2);
    expect(JSON.stringify(body)).not.toContain("Erjon Brendi");
  });

  it("reads the board unscoped for every role — the redaction is the control", async () => {
    for (const role of ROLES) {
      vi.clearAllMocks();
      leaderboardStore();
      db.user.findMany.mockResolvedValue(REPS);
      currentActor = as(role);
      await leaderboard.GET(get(LEADERBOARD_URL), NO_CTX);
      const [text] = db.$queryRawUnsafe.mock.calls[0];
      expect(text).not.toContain("sales_owner_id =");
    }
  });

  it("counts commissions by the bill's date, not the commission's created_at", async () => {
    currentActor = as("SUPER_ADMIN");
    await leaderboard.GET(get(LEADERBOARD_URL), NO_CTX);
    const args = db.commission.groupBy.mock.calls[0][0];
    expect(args.where).toEqual({
      bill: { billDate: { gte: new Date("2026-09-01T00:00:00Z"), lt: new Date("2026-10-01T00:00:00Z") } },
    });
  });

  it("422 on a period the schema does not accept", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await leaderboard.GET(get("http://t/api/analytics/leaderboard?period=2026-13"), NO_CTX);
    expect(response.status).toBe(422);
  });
});

describe("revenue: scope, bounds and money", () => {
  beforeEach(() => {
    db.client.findMany.mockResolvedValue([
      { id: "c1", name: "Bar Rei" },
      { id: "c2", name: "Hotel Dea" },
    ]);
  });

  it("scopes a rep's rows in SQL and reports the scope back", async () => {
    currentActor = as("OUTSIDE_SALES");
    db.$queryRawUnsafe.mockResolvedValue([]);
    const body = await (await revenue.GET(get(REVENUE_URL), NO_CTX)).json();
    expect(body.scope).toBe("own");
    const [text, ...values] = db.$queryRawUnsafe.mock.calls[0];
    expect(text).toContain("c.sales_owner_id = $");
    expect(values).toContain("u-OUTSIDE_SALES");
  });

  it("does not scope a Super Admin", async () => {
    currentActor = as("SUPER_ADMIN");
    const body = await (await revenue.GET(get(REVENUE_URL), NO_CTX)).json();
    expect(body.scope).toBe("all");
    expect(db.$queryRawUnsafe.mock.calls[0][0]).not.toContain("sales_owner_id =");
  });

  it("truncates at the limit and still reports an honest grand total", async () => {
    currentActor = as("SUPER_ADMIN");
    db.$queryRawUnsafe
      // The grouped query asks for limit + 1 rows.
      .mockResolvedValueOnce([
        { key: "c1", revenue: "300000.00", bill_count: 3 },
        { key: "c2", revenue: "200000.00", bill_count: 2 },
        { key: "c3", revenue: "100000.00", bill_count: 1 },
      ])
      .mockResolvedValueOnce([{ revenue: "600000.00", bill_count: 6 }]);

    const body = await (
      await revenue.GET(get(`${REVENUE_URL}&limit=2`), NO_CTX)
    ).json();

    expect(body.rows).toHaveLength(2);
    expect(body.truncated).toBe(true);
    // 600000 is the whole set, not the 500000 of the two rows shown.
    expect(body.total.revenue).toBe("600000.00");
    expect(body.total.billCount).toBe(6);
  });

  it("formats money as fixed-scale strings, never numbers", async () => {
    currentActor = as("SUPER_ADMIN");
    db.$queryRawUnsafe
      .mockResolvedValueOnce([
        { key: "c1", revenue: "1200.5", bill_count: 2 },
        { key: "c2", revenue: null, bill_count: 0 },
      ])
      .mockResolvedValueOnce([{ revenue: null, bill_count: 0 }]);

    const body = await (await revenue.GET(get(REVENUE_URL), NO_CTX)).json();
    expect(body.rows[0].revenue).toBe("1200.50");
    expect(body.rows[1].revenue).toBe("0.00");
    expect(body.total.revenue).toBe("0.00");
    for (const row of body.rows) expect(typeof row.revenue).toBe("string");
  });

  it("labels client keys with their names and month keys with themselves", async () => {
    currentActor = as("SUPER_ADMIN");
    db.$queryRawUnsafe
      .mockResolvedValueOnce([{ key: "c1", revenue: "10.00", bill_count: 1 }])
      .mockResolvedValueOnce([{ revenue: "10.00", bill_count: 1 }]);
    const byClient = await (await revenue.GET(get(REVENUE_URL), NO_CTX)).json();
    expect(byClient.rows[0].label).toBe("Bar Rei");

    vi.clearAllMocks();
    db.$queryRawUnsafe
      .mockResolvedValueOnce([{ key: "2026-03", revenue: "10.00", bill_count: 1 }])
      .mockResolvedValueOnce([{ revenue: "10.00", bill_count: 1 }]);
    const byMonth = await (
      await revenue.GET(
        get("http://t/api/analytics/revenue?groupBy=month&from=2026-01-01&to=2026-09-30"),
        NO_CTX,
      )
    ).json();
    expect(byMonth.rows[0].label).toBe("2026-03");
    expect(db.client.findMany).not.toHaveBeenCalled();
  });

  it("422 without a window, and before touching the database", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await revenue.GET(get("http://t/api/analytics/revenue?groupBy=client"), NO_CTX);
    expect(response.status).toBe(422);
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe("commission summary", () => {
  it("is scoped exactly as the commission list is scoped", async () => {
    const expected: Record<Role, Record<string, unknown>> = {
      SUPER_ADMIN: {},
      SALES: { salesUserId: "u-SALES" },
      OUTSIDE_SALES: { salesUserId: "u-OUTSIDE_SALES" },
    };
    for (const role of ROLES) {
      vi.clearAllMocks();
      db.commission.groupBy.mockResolvedValue([]);
      currentActor = as(role);
      await summary.GET(get("http://t/api/analytics/commissions/summary"), NO_CTX);
      expect(db.commission.groupBy.mock.calls[0][0].where).toEqual(expected[role]);
    }
  });

  it("returns every status, zero-filled, and sums them exactly", async () => {
    currentActor = as("SUPER_ADMIN");
    db.commission.groupBy.mockResolvedValue([
      { status: "PENDING", _sum: { commissionAmount: decimal("0.01") }, _count: { _all: 1 } },
      { status: "PAID", _sum: { commissionAmount: decimal("0.02") }, _count: { _all: 2 } },
    ]);

    const body = await (
      await summary.GET(get("http://t/api/analytics/commissions/summary"), NO_CTX)
    ).json();

    expect(body.byStatus.APPROVED).toEqual({ count: 0, amount: "0.00" });
    expect(body.byStatus.PENDING.amount).toBe("0.01");
    // 0.01 + 0.02 is 0.030000000000000002 as floats; it is 0.03 here.
    expect(body.total.amount).toBe("0.03");
    expect(body.total.count).toBe(3);
  });
});

describe("audit-logs: the Super Admin viewer", () => {
  beforeEach(() => {
    currentActor = as("SUPER_ADMIN");
    db.auditLog.count.mockResolvedValue(1);
    db.auditLog.findMany.mockResolvedValue([
      {
        id: "a1",
        entityType: "BILL",
        entityId: "f1",
        action: "VERIFY",
        actor: { id: "u-SALES", name: "Erjon Brendi" },
        diff: { before: { status: "PENDING" }, after: { status: "VERIFIED" } },
        ipAddress: "10.0.0.1",
        createdAt: new Date("2026-09-17T10:00:00Z"),
      },
    ]);
  });

  it("paginates server-side", async () => {
    await auditLogs.GET(get("http://t/api/audit-logs?page=3&pageSize=10"), NO_CTX);
    const args = db.auditLog.findMany.mock.calls[0][0];
    expect(args.take).toBe(10);
    expect(args.skip).toBe(20);
  });

  it("refuses an oversized page instead of returning an unbounded set", async () => {
    const response = await auditLogs.GET(get("http://t/api/audit-logs?pageSize=9999"), NO_CTX);
    expect(response.status).toBe(422);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("filters by entity, actor, action and date range", async () => {
    await auditLogs.GET(
      get(
        "http://t/api/audit-logs?entityType=BILL&entityId=f1&actorId=u-SALES&action=VERIFY&dateFrom=2026-09-01&dateTo=2026-09-30",
      ),
      NO_CTX,
    );
    const where = db.auditLog.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      entityType: "BILL",
      entityId: "f1",
      actorId: "u-SALES",
      action: "VERIFY",
    });
    // dateTo is inclusive for the reader, so the bound is the following midnight.
    expect(where.createdAt).toEqual({
      gte: new Date("2026-09-01T00:00:00.000Z"),
      lt: new Date("2026-10-01T00:00:00.000Z"),
    });
  });

  it("rejects a sort field that is not allowlisted, before touching the database", async () => {
    const response = await auditLogs.GET(get("http://t/api/audit-logs?sort=diff:asc"), NO_CTX);
    expect(response.status).toBe(422);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("rejects a reversed date range", async () => {
    const response = await auditLogs.GET(
      get("http://t/api/audit-logs?dateFrom=2026-09-30&dateTo=2026-09-01"),
      NO_CTX,
    );
    expect(response.status).toBe(422);
  });

  it("exposes no writer — the log is append-only", async () => {
    // Section 8: "immutable — no update/delete on the audit_logs table itself".
    // A route module that exports no mutating handler is how Next enforces that.
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(auditLogs).not.toHaveProperty(method);
    }
  });
});
