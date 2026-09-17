/**
 * Phase 6, step 20: "Performance tuning based on real usage (indexes,
 * materialized views)".
 *
 * There is no real usage yet, so this script manufactures the next best thing —
 * a volume-realistic dataset — and measures the queries the dashboard, the
 * analytics and the lists actually run, before and after each candidate index.
 * The point is not to add indexes; it is to be able to refuse one. Section 9 is
 * explicit: "don't over-index upfront".
 *
 *   node scripts/benchmark.mjs                 # seed + measure + report
 *   node scripts/benchmark.mjs --keep          # keep the seeded rows
 *   node scripts/benchmark.mjs --bills=300000  # heavier
 *
 * It TRUNCATEs every table, so it refuses to run unless the database name ends
 * in _test or _dev, or --force is passed.
 */
import "dotenv/config";
import { Client } from "pg";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};

const CLIENTS = flag("clients", 300);
const CONTRACTS_PER_CLIENT = flag("contractsPerClient", 2);
const BILLS = flag("bills", 120_000);
const MONTHS = flag("months", 24);
const RUNS = flag("runs", 5);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const dbName = new URL(connectionString).pathname.replace(/^\//, "");
if (!/_(test|dev)$/.test(dbName) && !argv.includes("--force")) {
  console.error(
    `Refusing to truncate "${dbName}". Point DATABASE_URL at a _test/_dev database, or pass --force.`,
  );
  process.exit(1);
}

const db = new Client({ connectionString });
await db.connect();

/* ------------------------------------------------------------------ seeding */

async function seed() {
  await db.query(
    'TRUNCATE "revenue_summaries","notification_preferences","notifications","audit_logs","commissions","bills","contracts","clients","invites","users" CASCADE',
  );

  // 1 Super Admin + 11 reps: the plan's "a dozen reps".
  await db.query(`
    INSERT INTO "users"(id,email,name,role,status,updated_at)
    SELECT 'u'||i, 'rep'||i||'@radx.app', 'Rep '||i,
           CASE WHEN i = 0 THEN 'SUPER_ADMIN'
                WHEN i % 3 = 0 THEN 'OUTSIDE_SALES' ELSE 'SALES' END::"UserRole",
           'ACTIVE', now()
      FROM generate_series(0, 11) i`);

  await db.query(
    `
    INSERT INTO "clients"(id,name,type,city,acquired_by,status,updated_at)
    SELECT 'c'||i, 'Klienti '||i,
           (ARRAY['BAR','RESTAURANT','HOTEL','OFFICE','OTHER'])[1 + i % 5]::"ClientType",
           (ARRAY['Tiranë','Durrës','Vlorë','Shkodër'])[1 + i % 4],
           'u'||(1 + i % 11), 'ACTIVE', now()
      FROM generate_series(1, $1) i`,
    [CLIENTS],
  );

  // Every client has a current contract and a history of renewed ones, which is
  // what makes `contracts(client_id, status)` worth measuring at all.
  await db.query(
    `
    INSERT INTO "contracts"(id,client_id,sales_owner_id,commission_percentage,start_date,end_date,status,updated_at)
    SELECT 'k'||i||'_'||g, 'c'||i, 'u'||(1 + i % 11),
           5 + (i % 6),
           date '2024-01-01' + (g * interval '12 months'),
           date '2024-12-31' + (g * interval '12 months'),
           CASE WHEN g = $2 - 1 THEN 'ACTIVE' ELSE 'RENEWED' END::"ContractStatus",
           now()
      FROM generate_series(1, $1) i, generate_series(0, $2 - 1) g`,
    [CLIENTS, CONTRACTS_PER_CLIENT],
  );

  const active = CLIENTS;
  await db.query(
    `
    INSERT INTO "bills"(id,contract_id,client_id,bill_number,amount,currency,bill_date,entered_by,status,updated_at)
    SELECT 'b'||i,
           'k'||(1 + i % $2)||'_'||($3 - 1),
           'c'||(1 + i % $2),
           'F-'||i,
           1000 + (i % 900) * 100,
           'ALL',
           date '2026-09-30' - ((i % $4) * interval '1 day') - ((i % $5) * interval '30 days'),
           'u'||(1 + i % 11),
           (ARRAY['VERIFIED','VERIFIED','VERIFIED','PENDING','DISPUTED','VOID'])[1 + i % 6]::"BillStatus",
           now()
      FROM generate_series(1, $1) i`,
    [BILLS, active, CONTRACTS_PER_CLIENT, 30, MONTHS],
  );

  // A commission exists only for a VERIFIED bill — the Phase 3 invariant.
  await db.query(`
    INSERT INTO "commissions"(id,bill_id,contract_id,sales_user_id,commission_percentage_snapshot,base_amount,commission_amount,status)
    SELECT 'cm'||b.id, b.id, b.contract_id, k.sales_owner_id,
           k.commission_percentage, b.amount,
           round(b.amount * k.commission_percentage / 100, 2),
           (ARRAY['PENDING','APPROVED','PAID'])[1 + (('x'||substr(md5(b.id),1,8))::bit(32)::int & 2)]::"CommissionStatus"
      FROM "bills" b JOIN "contracts" k ON k.id = b.contract_id
     WHERE b.status = 'VERIFIED'`);

  await db.query(`
    INSERT INTO "audit_logs"(id,actor_id,entity_type,entity_id,action,created_at)
    SELECT 'a'||id, 'u1', 'BILL', id, 'VERIFY', now() - (random() * interval '365 days')
      FROM "bills" WHERE status = 'VERIFIED'`);

  // Phase 5's nightly rollup, run here so the "live vs summary" pair is measured
  // on the same data — and computed by the same predicate the rollup uses.
  await db.query(`
    INSERT INTO "revenue_summaries"(id,grain,subject_id,period_month,revenue,bill_count,commission_amount,commission_count,computed_at)
    SELECT 'rs_c_'||b.client_id||'_'||to_char(date_trunc('month', b.bill_date), 'YYYYMM'),
           'CLIENT', b.client_id, date_trunc('month', b.bill_date)::date,
           SUM(b.amount), COUNT(*)::int, 0, 0, now()
      FROM "bills" b
     WHERE b.status <> 'VOID'
     GROUP BY 1, 3, 4`);

  await db.query("ANALYZE");

  const counts = await db.query(`
    SELECT (SELECT count(*) FROM "clients") clients,
           (SELECT count(*) FROM "contracts") contracts,
           (SELECT count(*) FROM "bills") bills,
           (SELECT count(*) FROM "commissions") commissions,
           (SELECT count(*) FROM "audit_logs") audit`);
  return counts.rows[0];
}

/* ----------------------------------------------------------------- measuring */

/**
 * The statements the application actually issues. The two revenue queries are
 * the text `lib/queries/analytics-sql.ts` builds — copied here deliberately: if
 * the builder changes, this file has to be updated with it, and a benchmark that
 * silently measures something else is worse than no benchmark.
 */
const RANGE = ["2025-10-01", "2026-10-01"];

const QUERIES = [
  {
    name: "analytics: revenue by client (12m)",
    text: `SELECT b.client_id AS key, COALESCE(SUM(b.amount), 0)::text AS revenue, COUNT(*)::int AS bill_count
             FROM bills b JOIN contracts c ON c.id = b.contract_id
            WHERE b.status <> 'VOID' AND b.bill_date >= $1 AND b.bill_date < $2
            GROUP BY 1 ORDER BY SUM(b.amount) DESC, 1 ASC LIMIT 101`,
    values: RANGE,
  },
  {
    name: "analytics: revenue by rep (12m)",
    text: `SELECT c.sales_owner_id AS key, COALESCE(SUM(b.amount), 0)::text AS revenue, COUNT(*)::int AS bill_count
             FROM bills b JOIN contracts c ON c.id = b.contract_id
            WHERE b.status <> 'VOID' AND b.bill_date >= $1 AND b.bill_date < $2
            GROUP BY 1 ORDER BY SUM(b.amount) DESC, 1 ASC LIMIT 101`,
    values: RANGE,
  },
  {
    name: "analytics: revenue by month, one rep",
    text: `SELECT to_char(date_trunc('month', b.bill_date), 'YYYY-MM') AS key,
                  COALESCE(SUM(b.amount), 0)::text AS revenue, COUNT(*)::int AS bill_count
             FROM bills b JOIN contracts c ON c.id = b.contract_id
            WHERE b.status <> 'VOID' AND b.bill_date >= $1 AND b.bill_date < $2 AND c.sales_owner_id = $3
            GROUP BY 1 ORDER BY SUM(b.amount) DESC, 1 ASC LIMIT 13`,
    values: [...RANGE, "u2"],
  },
  {
    name: "analytics: revenue total (12m)",
    text: `SELECT COALESCE(SUM(b.amount), 0)::text AS revenue, COUNT(*)::int AS bill_count
             FROM bills b JOIN contracts c ON c.id = b.contract_id
            WHERE b.status <> 'VOID' AND b.bill_date >= $1 AND b.bill_date < $2`,
    values: RANGE,
  },
  {
    name: "commissions: payout list, one rep, one month",
    text: `SELECT cm.* FROM commissions cm JOIN bills b ON b.id = cm.bill_id
            WHERE cm.sales_user_id = $1 AND b.bill_date >= $2 AND b.bill_date < $3
            ORDER BY cm.created_at DESC LIMIT 25`,
    values: ["u2", "2026-09-01", "2026-10-01"],
  },
  {
    name: "commissions: batch-approve candidates (month)",
    text: `SELECT cm.id FROM commissions cm JOIN bills b ON b.id = cm.bill_id
            WHERE cm.status = 'PENDING' AND b.bill_date >= $1 AND b.bill_date < $2`,
    values: ["2026-09-01", "2026-10-01"],
  },
  {
    name: "contracts: expiry report (90 days)",
    text: `SELECT * FROM contracts WHERE status = 'ACTIVE' AND end_date IS NOT NULL AND end_date <= $1
            ORDER BY end_date ASC, id ASC LIMIT 5001`,
    values: ["2026-12-31"],
  },
  {
    name: "bills: list page, one contract",
    text: `SELECT * FROM bills WHERE contract_id = $1 ORDER BY bill_date DESC LIMIT 25`,
    values: ["k1_1"],
  },
  {
    name: "dashboard: 12m trend, live aggregation",
    text: `SELECT to_char(date_trunc('month', b.bill_date), 'YYYY-MM') AS key,
                  COALESCE(SUM(b.amount), 0)::text AS revenue, COUNT(*)::int AS bill_count
             FROM bills b JOIN contracts c ON c.id = b.contract_id
            WHERE b.status <> 'VOID' AND b.bill_date >= $1 AND b.bill_date < $2
            GROUP BY 1 ORDER BY 1`,
    values: RANGE,
  },
  {
    name: "dashboard: 12m trend, from revenue_summaries",
    text: `SELECT to_char(period_month, 'YYYY-MM') AS key,
                  SUM(revenue)::text AS revenue, SUM(bill_count)::int AS bill_count
             FROM revenue_summaries
            WHERE grain = 'CLIENT' AND period_month >= $1 AND period_month < $2
            GROUP BY 1 ORDER BY 1`,
    values: RANGE,
  },
  {
    name: "audit: one entity's history",
    text: `SELECT * FROM audit_logs WHERE entity_type = 'BILL' AND entity_id = $1 ORDER BY created_at DESC LIMIT 25`,
    values: ["b1000"],
  },
];

/**
 * Candidate indexes, each with the reason it is a candidate at all.
 * `--candidates=name,name` measures a subset — an index has to be attributable,
 * and two added together only say what the pair did.
 */
const ALL_CANDIDATES = [
  {
    name: "bills_bill_date_status_idx",
    sql: 'CREATE INDEX "bills_bill_date_status_idx" ON "bills"("bill_date", "status")',
    why: "every analytics query filters bill_date and excludes VOID (Phase 4 note)",
  },
  {
    name: "bills_bill_date_idx",
    sql: 'CREATE INDEX "bills_bill_date_idx" ON "bills"("bill_date")',
    why: "the date predicate alone, without tempting the planner with status",
  },
  {
    name: "bills_bill_date_notvoid_idx",
    sql: `CREATE INDEX "bills_bill_date_notvoid_idx" ON "bills"("bill_date") WHERE status <> 'VOID'`,
    why: "partial: revenue is always non-VOID, so the index is the revenue set",
  },
  {
    name: "commissions_status_idx",
    sql: 'CREATE INDEX "commissions_status_idx" ON "commissions"("status")',
    why: "batch approval scans for PENDING across the whole table",
  },
  {
    name: "contracts_status_end_date_idx_exists",
    sql: null,
    why: "already created by the initial migration — measured, not added",
  },
];

const selected = argv.find((arg) => arg.startsWith("--candidates="));
const CANDIDATES = selected
  ? ALL_CANDIDATES.filter((candidate) => selected.split("=")[1].split(",").includes(candidate.name))
  : ALL_CANDIDATES;

async function measure(query) {
  const timings = [];
  for (let run = 0; run < RUNS; run += 1) {
    const explained = await db.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.text}`,
      query.values,
    );
    const plan = explained.rows[0]["QUERY PLAN"][0];
    timings.push(plan["Execution Time"]);
  }
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)];

  const explained = await db.query(
    `EXPLAIN (ANALYZE, FORMAT JSON) ${query.text}`,
    query.values,
  );
  return { median, node: explained.rows[0]["QUERY PLAN"][0].Plan["Node Type"] };
}

async function measureAll() {
  const results = {};
  for (const query of QUERIES) results[query.name] = await measure(query);
  return results;
}

/* -------------------------------------------------------------------- report */

const counts = await seed();
console.log(
  `Seeded: ${counts.clients} clients, ${counts.contracts} contracts, ${counts.bills} bills, ` +
    `${counts.commissions} commissions, ${counts.audit} audit rows\n`,
);

const before = await measureAll();

for (const candidate of CANDIDATES) {
  if (candidate.sql) await db.query(candidate.sql);
}
await db.query("ANALYZE");

const after = await measureAll();

const pad = (value, width) => String(value).padEnd(width);
const num = (value) => `${value.toFixed(1)} ms`.padStart(10);

console.log(`${pad("query", 44)}${pad("before", 12)}${pad("after", 12)}change`);
console.log("-".repeat(80));
for (const query of QUERIES) {
  const b = before[query.name].median;
  const a = after[query.name].median;
  const change = b === 0 ? "—" : `${(((a - b) / b) * 100).toFixed(0)}%`;
  console.log(`${pad(query.name, 44)}${num(b)}  ${num(a)}  ${change.padStart(7)}`);
}

console.log("\nCandidates:");
for (const candidate of CANDIDATES) {
  console.log(`  ${candidate.name}${candidate.sql ? "" : " (pre-existing)"} — ${candidate.why}`);
}

console.log("\nPlan nodes after:");
for (const query of QUERIES) {
  console.log(`  ${pad(query.name, 44)}${before[query.name].node} → ${after[query.name].node}`);
}

if (!argv.includes("--keep")) {
  await db.query(
    'TRUNCATE "revenue_summaries","notification_preferences","notifications","audit_logs","commissions","bills","contracts","clients","invites","users" CASCADE',
  );
  for (const candidate of CANDIDATES) {
    if (candidate.sql) await db.query(`DROP INDEX IF EXISTS "${candidate.name}"`);
  }
}

await db.end();
