import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn(async () => ({ delivered: true }));
vi.mock("@/lib/email/mailer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/mailer")>("@/lib/email/mailer");
  return { ...actual, sendMail };
});

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

const { sendDailyDigest, digestDay, digestBody } = await import("@/lib/jobs/digest");
const { sendMonthlyReport, closedMonth } = await import("@/lib/jobs/monthly-report");
const { getMonthlyTrend, trendMonths } = await import("@/lib/queries/summaries");

const NOW = new Date("2026-09-17T06:00:00Z");
const decimal = (value: string) => ({ toFixed: (dp: number) => Number(value).toFixed(dp) });
const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0];
const as = (role: "SUPER_ADMIN" | "SALES" | "OUTSIDE_SALES") => ({ id: `u-${role}`, role });

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
});

describe("daily digest", () => {
  const subscription = { userId: "u-SALES", type: "COMMISSION_APPROVED" };
  const item = (overrides: Record<string, unknown> = {}) => ({
    userId: "u-SALES",
    type: "COMMISSION_APPROVED",
    title: "Komisioni u aprovua",
    body: "Komisioni prej 9000.00 u aprovua.",
    createdAt: new Date("2026-09-16T10:00:00Z"),
    user: { email: "rep@radx.app", name: "Blerta", status: "ACTIVE" },
    ...overrides,
  });

  it("covers yesterday, as a whole UTC day", () => {
    expect(digestDay(NOW)).toEqual(new Date("2026-09-16T00:00:00.000Z"));
  });

  it("does nothing when nobody asked for a digest", async () => {
    const result = await sendDailyDigest(digestDay(NOW));
    expect(result).toEqual({ day: "2026-09-16", users: 0, notifications: 0 });
    expect(db.notification.findMany).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("asks only for the (user, type) pairs that opted in, inside the day", async () => {
    db.notificationPreference.findMany.mockResolvedValue([subscription]);
    await sendDailyDigest(digestDay(NOW));

    expect(lastCall(db.notificationPreference.findMany).where).toEqual({ email: "DIGEST" });
    expect(lastCall(db.notification.findMany).where).toEqual({
      createdAt: {
        gte: new Date("2026-09-16T00:00:00.000Z"),
        lt: new Date("2026-09-17T00:00:00.000Z"),
      },
      OR: [{ userId: "u-SALES", type: "COMMISSION_APPROVED" }],
    });
  });

  it("sends one email per user, listing what arrived", async () => {
    db.notificationPreference.findMany.mockResolvedValue([subscription]);
    db.notification.findMany.mockResolvedValue([item(), item({ title: "Komisioni u pagua" })]);

    const result = await sendDailyDigest(digestDay(NOW));

    expect(result).toEqual({ day: "2026-09-16", users: 1, notifications: 2 });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = lastCall(sendMail) as { to: string; subject: string; text: string };
    expect(mail.to).toBe("rep@radx.app");
    expect(mail.subject).toContain("2026-09-16");
    expect(mail.text).toContain("Komisioni u aprovua");
    expect(mail.text).toContain("Komisioni u pagua");
  });

  it("skips a suspended user", async () => {
    db.notificationPreference.findMany.mockResolvedValue([subscription]);
    db.notification.findMany.mockResolvedValue([
      item({ user: { email: "gone@radx.app", name: "X", status: "SUSPENDED" } }),
    ]);

    const result = await sendDailyDigest(digestDay(NOW));
    expect(result.users).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("writes one bullet per item", () => {
    const body = digestBody("Blerta", [{ title: "A", body: "a" }, { title: "B", body: "b" }]);
    expect(body).toContain("• A");
    expect(body).toContain("• B");
    expect(body.startsWith("Përshëndetje Blerta")).toBe(true);
  });
});

describe("monthly report", () => {
  beforeEach(() => {
    db.user.findMany.mockResolvedValue([{ email: "admin@radx.app", name: "Admin" }]);
    // Answering by grain rather than by call order: the report reads both, and a
    // queued `once` would leak into the next describe.
    db.revenueSummary.findMany.mockImplementation(async (args: { where: { grain: string } }) =>
      args.where.grain === "CLIENT"
        ? [
            {
              subjectId: "c1",
              revenue: decimal("120000.00"),
              billCount: 2,
              commissionAmount: decimal("0.00"),
              commissionCount: 0,
            },
          ]
        : [
            {
              subjectId: "u-SALES",
              revenue: decimal("120000.00"),
              billCount: 2,
              commissionAmount: decimal("9000.00"),
              commissionCount: 2,
            },
          ],
    );
    db.client.findMany.mockResolvedValue([{ id: "c1", name: "Bar Çelësi" }]);
  });

  it("reports the month that has just closed", () => {
    expect(closedMonth(NOW)).toBe("2026-08");
    expect(closedMonth(new Date("2026-01-01T00:00:00Z"))).toBe("2025-12");
  });

  it("rolls the month again before reading it", async () => {
    await sendMonthlyReport("2026-08");
    // A bill entered on the 31st has to be in a report generated on the 1st, so
    // the rollup runs first — its transaction is the evidence.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$queryRawUnsafe).toHaveBeenCalled();
  });

  it("emails every active Super Admin, with the PDF attached", async () => {
    const result = await sendMonthlyReport("2026-08");

    expect(db.user.findMany.mock.calls[0][0].where).toEqual({
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    });
    expect(result).toMatchObject({ month: "2026-08", recipients: 1, clients: 1, reps: 1 });

    const mail = lastCall(sendMail) as {
      to: string;
      text: string;
      attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
    };
    expect(mail.to).toBe("admin@radx.app");
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].filename).toBe("rei-crm-2026-08.pdf");
    expect(mail.attachments[0].contentType).toBe("application/pdf");
    expect(mail.attachments[0].content.subarray(0, 5).toString()).toBe("%PDF-");
    // The summary in the body agrees with the attachment it summarises.
    expect(mail.text).toContain("120000.00");
    expect(mail.text).toContain("9000.00");
  });

  it("reads the summaries rather than the bills", async () => {
    await sendMonthlyReport("2026-08");
    const grains = db.revenueSummary.findMany.mock.calls.map((call) => call[0].where.grain);
    expect(grains.sort()).toEqual(["CLIENT", "SALES_REP"]);
    expect(db.bill.findMany).not.toHaveBeenCalled();
  });
});

describe("dashboard trend from the summaries", () => {
  const summaryRow = (month: number, revenue: string) => ({
    periodMonth: new Date(Date.UTC(2026, month - 1, 1)),
    revenue: decimal(revenue),
    billCount: 3,
  });

  it("lists the months oldest first, ending with the current one", () => {
    expect(trendMonths(NOW, 3)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("reads closed months from the summaries and the current month live", async () => {
    db.revenueSummary.findMany.mockResolvedValue([summaryRow(7, "1000.00"), summaryRow(8, "2000.00")]);
    db.$queryRawUnsafe.mockResolvedValue([{ key: "2026-09", revenue: "500.00", bill_count: 1 }]);

    const trend = await getMonthlyTrend(as("SUPER_ADMIN"), 3, NOW);

    expect(trend.source).toBe("summaries");
    expect(trend.rows).toEqual([
      { key: "2026-07", revenue: "1000.00", billCount: 3 },
      { key: "2026-08", revenue: "2000.00", billCount: 3 },
      { key: "2026-09", revenue: "500.00", billCount: 1 },
    ]);
    expect(trend.total).toEqual({ revenue: "3500.00", billCount: 7 });
    // One live query, for the current month only — not for the window.
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it("falls back to the live query when the rollup has produced nothing", async () => {
    db.revenueSummary.findMany.mockResolvedValue([]);
    db.$queryRawUnsafe.mockResolvedValue([
      { key: "2026-08", revenue: "2000.00", bill_count: 3 },
      { key: "2026-09", revenue: "500.00", bill_count: 1 },
    ]);

    const trend = await getMonthlyTrend(as("SUPER_ADMIN"), 3, NOW);

    expect(trend.source).toBe("live");
    // Zeros would be a lie; the real figures come from the bills.
    expect(trend.rows.map((row) => row.revenue)).toEqual(["0.00", "2000.00", "500.00"]);
  });

  it("reads a rep's own grain, and only their own rows", async () => {
    db.revenueSummary.findMany.mockResolvedValue([summaryRow(8, "700.00")]);
    await getMonthlyTrend(as("OUTSIDE_SALES"), 3, NOW);

    expect(lastCall(db.revenueSummary.findMany).where).toMatchObject({
      grain: "SALES_REP",
      subjectId: "u-OUTSIDE_SALES",
    });
  });

  it("reads the whole business for a Super Admin", async () => {
    db.revenueSummary.findMany.mockResolvedValue([summaryRow(8, "700.00")]);
    await getMonthlyTrend(as("SUPER_ADMIN"), 3, NOW);

    const where = lastCall(db.revenueSummary.findMany).where;
    expect(where.grain).toBe("CLIENT");
    expect(where.subjectId).toBeUndefined();
  });

  it("never reads a summary for the current month", async () => {
    db.revenueSummary.findMany.mockResolvedValue([summaryRow(8, "700.00")]);
    await getMonthlyTrend(as("SUPER_ADMIN"), 3, NOW);

    // The current month is still changing; the rollup ran last night.
    expect(lastCall(db.revenueSummary.findMany).where.periodMonth).toEqual({
      gte: new Date(Date.UTC(2026, 6, 1)),
      lt: new Date(Date.UTC(2026, 8, 1)),
    });
  });
});
