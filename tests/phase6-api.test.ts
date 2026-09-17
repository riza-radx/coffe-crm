import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES, type Actor, type Role } from "@/lib/rbac/types";
import { NOTIFICATION_TYPES } from "@/lib/notifications/types";

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

const enqueueNotificationEmails = vi.fn(async () => {});
vi.mock("@/lib/jobs/queue", () => ({
  QUEUES: {
    notificationEmail: "notifications.email",
    contractSweep: "contracts.daily-sweep",
    summaryRollup: "summaries.nightly-rollup",
    notificationDigest: "notifications.daily-digest",
    monthlyReport: "reports.monthly",
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
    deleteMany: vi.fn(),
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
  "auditLog",
  "notification",
  "notificationPreference",
  "revenueSummary",
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

const preferences = await import("@/app/api/notifications/preferences/route");
const notifications = await import("@/app/api/notifications/route");
const commissions = await import("@/app/api/commissions/route");
const contracts = await import("@/app/api/contracts/route");
const revenue = await import("@/app/api/analytics/revenue/route");
const { writeNotifications, templates } = await import("@/lib/notifications/notify");

const as = (role: Role): Actor => ({ id: `u-${role}`, role });
const NO_CTX = {} as never;
const get = (url: string) => new Request(url);
const put = (url: string, body: unknown) =>
  new Request(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const decimal = (value: string) => ({ toFixed: (dp: number) => Number(value).toFixed(dp) });
const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0];

const COMMISSION_ROW = {
  id: "cm1",
  status: "APPROVED",
  baseAmount: decimal("120000.00"),
  commissionPercentageSnapshot: decimal("7.50"),
  commissionAmount: decimal("9000.00"),
  createdAt: new Date("2026-09-17T00:00:00Z"),
  paidAt: null,
  salesUser: { id: "u-SALES", name: "Blerta Çela" },
  contract: { id: "k1" },
  bill: {
    id: "f1",
    billNumber: "F-001",
    billDate: new Date("2026-09-10T00:00:00Z"),
    status: "VERIFIED",
    client: { id: "c1", name: "Bar Çelësi" },
  },
};

const CONTRACT_ROW = {
  id: "k1",
  status: "ACTIVE",
  commissionPercentage: decimal("7.50"),
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2026-10-15T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  client: { id: "c1", name: "Bar Çelësi" },
  salesOwner: { id: "u-SALES", name: "Blerta Çela" },
};

const REVENUE_URL = "http://t/api/analytics/revenue?groupBy=client&from=2026-09-01&to=2026-09-30";

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
      store[key].deleteMany.mockResolvedValue({ count: 1 });
    }
  }
  db.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  db.$queryRawUnsafe.mockResolvedValue([]);
  tx.notification.create.mockResolvedValue({ id: "n1" });
  db.commission.findMany.mockResolvedValue([COMMISSION_ROW]);
  db.contract.findMany.mockResolvedValue([CONTRACT_ROW]);
});

describe("notification preferences", () => {
  it("answers with every type, defaulted, when nothing is stored", async () => {
    currentActor = as("OUTSIDE_SALES");
    const response = await preferences.GET(get("http://t/api/notifications/preferences"), NO_CTX);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { preferences: Array<Record<string, unknown>> };
    expect(body.preferences).toHaveLength(NOTIFICATION_TYPES.length);
    // A missing row is the default every user had before the table existed.
    expect(body.preferences.every((row) => row.inApp === true && row.email === "INSTANT")).toBe(true);
  });

  it("reads only the caller's own rows", async () => {
    currentActor = as("SUPER_ADMIN");
    await preferences.GET(get("http://t/api/notifications/preferences"), NO_CTX);
    expect(lastCall(db.notificationPreference.findMany).where).toEqual({ userId: "u-SUPER_ADMIN" });
  });

  it("stores a changed row and deletes one that is back to the default", async () => {
    currentActor = as("SALES");
    const response = await preferences.PUT(
      put("http://t/api/notifications/preferences", {
        preferences: [
          { type: "COMMISSION_APPROVED", inApp: true, email: "DIGEST" },
          { type: "BILL_DISPUTED", inApp: true, email: "INSTANT" },
        ],
      }),
      NO_CTX,
    );
    expect(response.status).toBe(200);

    expect(lastCall(tx.notificationPreference.upsert)).toMatchObject({
      where: { userId_type: { userId: "u-SALES", type: "COMMISSION_APPROVED" } },
      create: { userId: "u-SALES", type: "COMMISSION_APPROVED", email: "DIGEST" },
      update: { inApp: true, email: "DIGEST" },
    });
    // "no row" and "the default" have to keep meaning the same thing.
    expect(lastCall(tx.notificationPreference.deleteMany)).toEqual({
      where: { userId: "u-SALES", type: "BILL_DISPUTED" },
    });
    expect(tx.notificationPreference.upsert).toHaveBeenCalledTimes(1);
  });

  it("saves the whole set in one transaction", async () => {
    currentActor = as("SALES");
    await preferences.PUT(
      put("http://t/api/notifications/preferences", {
        preferences: NOTIFICATION_TYPES.map((type) => ({ type, inApp: false, email: "OFF" })),
      }),
      NO_CTX,
    );
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.notificationPreference.upsert).toHaveBeenCalledTimes(NOTIFICATION_TYPES.length);
  });

  it("refuses the same type twice", async () => {
    currentActor = as("SALES");
    const response = await preferences.PUT(
      put("http://t/api/notifications/preferences", {
        preferences: [
          { type: "COMMISSION_PAID", inApp: true, email: "OFF" },
          { type: "COMMISSION_PAID", inApp: false, email: "DIGEST" },
        ],
      }),
      NO_CTX,
    );
    expect(response.status).toBe(422);
    expect(tx.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("refuses an unknown delivery mode", async () => {
    currentActor = as("SALES");
    const response = await preferences.PUT(
      put("http://t/api/notifications/preferences", {
        preferences: [{ type: "COMMISSION_PAID", inApp: true, email: "SOMETIMES" }],
      }),
      NO_CTX,
    );
    expect(response.status).toBe(422);
  });
});

describe("preferences change what the bell shows", () => {
  it("hides a muted type from the feed and from the unread count", async () => {
    currentActor = as("SALES");
    db.notificationPreference.findMany.mockResolvedValue([{ type: "COMMISSION_PAID" }]);

    await notifications.GET(get("http://t/api/notifications"), NO_CTX);

    expect(lastCall(db.notification.findMany).where).toEqual({
      AND: [{ userId: "u-SALES" }, { type: { notIn: ["COMMISSION_PAID"] } }],
    });
    // The count has to agree with the list, or the badge outlives its rows.
    expect(lastCall(db.notification.count).where).toEqual({
      AND: [{ userId: "u-SALES" }, { readAt: null }, { type: { notIn: ["COMMISSION_PAID"] } }],
    });
  });

  it("still shows a muted type when it is asked for by name", async () => {
    currentActor = as("SALES");
    db.notificationPreference.findMany.mockResolvedValue([{ type: "COMMISSION_PAID" }]);

    await notifications.GET(get("http://t/api/notifications?type=COMMISSION_PAID"), NO_CTX);

    expect(lastCall(db.notification.findMany).where).toEqual({
      AND: [{ userId: "u-SALES" }, { type: "COMMISSION_PAID" }],
    });
  });
});

describe("preferences change how the email goes out", () => {
  const draft = () =>
    templates.commissionApproved({ userId: "u-SALES", commissionId: "cm1", amount: "9000.00" });

  it("enqueues an instant email by default", async () => {
    tx.notificationPreference.findMany.mockResolvedValue([]);
    expect(await writeNotifications(tx as never, [draft()])).toEqual(["n1"]);
  });

  it("writes the row but sends nothing when the type is set to digest", async () => {
    tx.notificationPreference.findMany.mockResolvedValue([
      { userId: "u-SALES", type: "COMMISSION_APPROVED", inApp: true, email: "DIGEST" },
    ]);
    expect(await writeNotifications(tx as never, [draft()])).toEqual([]);
    // The notification is the record that the event happened; only the email waits.
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
  });

  it("writes the row but never emails when the type is off", async () => {
    tx.notificationPreference.findMany.mockResolvedValue([
      { userId: "u-SALES", type: "COMMISSION_APPROVED", inApp: false, email: "OFF" },
    ]);
    expect(await writeNotifications(tx as never, [draft()])).toEqual([]);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
  });

  it("reads the preferences through the transaction, not through prisma", async () => {
    tx.notificationPreference.findMany.mockResolvedValue([]);
    await writeNotifications(tx as never, [draft()]);
    expect(tx.notificationPreference.findMany).toHaveBeenCalled();
    expect(db.notificationPreference.findMany).not.toHaveBeenCalled();
  });
});

describe("PDF exports", () => {
  const isPdf = async (response: Response) => {
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    return String.fromCharCode(...bytes.subarray(0, 5));
  };

  it("renders the commission statement as a PDF", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await commissions.GET(
      get("http://t/api/commissions?format=pdf&period=2026-09"),
      NO_CTX,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("komisione-2026-09.pdf");
    expect(await isPdf(response)).toBe("%PDF-");
  });

  it("renders the contract expiry list as a PDF", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await contracts.GET(
      get("http://t/api/contracts?format=pdf&status=ACTIVE&expiringBefore=2026-12-31"),
      NO_CTX,
    );
    expect(response.status).toBe(200);
    expect(await isPdf(response)).toBe("%PDF-");
    expect(response.headers.get("content-disposition")).toContain("kontrata-2026-12-31.pdf");
  });

  it("renders revenue per client as a PDF", async () => {
    currentActor = as("SUPER_ADMIN");
    db.$queryRawUnsafe.mockResolvedValue([{ key: "c1", revenue: "120000.00", bill_count: 2 }]);
    db.client.findMany.mockResolvedValue([{ id: "c1", name: "Bar Çelësi" }]);

    const response = await revenue.GET(get(`${REVENUE_URL}&format=pdf`), NO_CTX);
    expect(response.status).toBe(200);
    expect(await isPdf(response)).toBe("%PDF-");
  });

  it("answers JSON when no format is asked for", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await revenue.GET(get(REVENUE_URL), NO_CTX);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe("the contract expiry report", () => {
  it("asks for dated contracts only, soonest first", async () => {
    currentActor = as("SUPER_ADMIN");
    await contracts.GET(
      get("http://t/api/contracts?format=csv&status=ACTIVE&expiringBefore=2026-12-31"),
      NO_CTX,
    );
    const call = lastCall(db.contract.findMany);
    expect(call.where).toEqual({
      AND: [
        {},
        { status: "ACTIVE", endDate: { not: null, lte: new Date("2026-12-31T00:00:00.000Z") } },
      ],
    });
    expect(call.orderBy).toEqual([{ endDate: "asc" }, { id: "asc" }]);
    expect(call.skip).toBeUndefined();
  });

  it("keeps a rep inside their own contracts", async () => {
    currentActor = as("OUTSIDE_SALES");
    await contracts.GET(get("http://t/api/contracts?format=csv&expiringBefore=2026-12-31"), NO_CTX);
    expect(lastCall(db.contract.findMany).where.AND[0]).toEqual({ salesOwnerId: "u-OUTSIDE_SALES" });
  });

  it("puts the days remaining in the last column", async () => {
    currentActor = as("SUPER_ADMIN");
    const response = await contracts.GET(
      get("http://t/api/contracts?format=csv&expiringBefore=2026-12-31"),
      NO_CTX,
    );
    const body = await response.text();
    expect(body).toContain("Ditë të mbetura");
    expect(body).toContain("2026-10-15");
    expect(body).toContain("Bar Çelësi");
  });
});

describe("3 roles × 3 endpoints", () => {
  const cases = [
    {
      name: "GET /api/notifications/preferences",
      call: () => preferences.GET(get("http://t/api/notifications/preferences"), NO_CTX),
      expected: { SUPER_ADMIN: 200, SALES: 200, OUTSIDE_SALES: 200 },
    },
    {
      name: "GET /api/contracts?format=pdf",
      call: () =>
        contracts.GET(get("http://t/api/contracts?format=pdf&expiringBefore=2026-12-31"), NO_CTX),
      expected: { SUPER_ADMIN: 200, SALES: 200, OUTSIDE_SALES: 200 },
    },
    {
      name: "GET /api/analytics/revenue?format=csv",
      call: () => revenue.GET(get(`${REVENUE_URL}&format=csv`), NO_CTX),
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
        expect((await testCase.call()).status).toBe(testCase.expected[role]);
      });
    }
  }

  it("scopes every export by the caller, not by a parameter", async () => {
    currentActor = as("OUTSIDE_SALES");
    await commissions.GET(get("http://t/api/commissions?format=pdf&salesUserId=u-SALES"), NO_CTX);
    expect(lastCall(db.commission.findMany).where).toEqual({
      AND: [{ salesUserId: "u-OUTSIDE_SALES" }, { salesUserId: "u-SALES" }],
    });
  });
});
