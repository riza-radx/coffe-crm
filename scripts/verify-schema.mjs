/**
 * Schema-level verification that needs no generated Prisma client: it talks to
 * Postgres through `pg` and checks that the migration in prisma/migrations really
 * enforces what the technical plan says — unique email/token, one commission per
 * bill, foreign keys, decimal precision, enum values, and no hard-delete of a user
 * who owns rows.
 *
 *   node scripts/verify-schema.mjs
 *
 * It TRUNCATEs every table, so it refuses to run unless the database name ends in
 * _test or _dev, or --force is passed.
 */
import "dotenv/config";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const dbName = new URL(connectionString).pathname.replace(/^\//, "");
if (!/_(test|dev)$/.test(dbName) && !process.argv.includes("--force")) {
  console.error(
    `Refusing to truncate "${dbName}". Point DATABASE_URL at a _test/_dev database, or pass --force.`,
  );
  process.exit(1);
}

const db = new Client({ connectionString });
await db.connect();
const ok = [];
const fail = [];
const check = (name, cond) => (cond ? ok : fail).push(name);
const now = () => new Date();

// clean slate
await db.query('TRUNCATE "revenue_summaries","notifications","audit_logs","commissions","bills","contracts","clients","invites","users" CASCADE');

// 1. seed super admin
const adminId = randomUUID();
const adminHash = await bcrypt.hash("ChangeMe123!", 12);
await db.query(
  `INSERT INTO "users"(id,email,password_hash,name,role,status,updated_at) VALUES ($1,$2,$3,$4,'SUPER_ADMIN','ACTIVE',now())`,
  [adminId, "admin@radx.app", adminHash, "Rei Super Admin"],
);
const admin = (await db.query('SELECT * FROM "users" WHERE id=$1', [adminId])).rows[0];
check("seed: super admin is ACTIVE", admin.status === "ACTIVE" && admin.role === "SUPER_ADMIN");
check("seed: password verifies", await bcrypt.compare("ChangeMe123!", admin.password_hash));

// 2. duplicate email is rejected
try {
  await db.query(
    `INSERT INTO "users"(id,email,name,role,updated_at) VALUES ($1,$2,'Dup','SALES',now())`,
    [randomUUID(), "admin@radx.app"],
  );
  check("unique users.email", false);
} catch { check("unique users.email", true); }

// 3. invite a SALES rep: user row INVITED with no password + invite token
const repId = randomUUID();
const token = randomBytes(32).toString("base64url");
const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);
await db.query("BEGIN");
await db.query(
  `INSERT INTO "users"(id,email,name,role,status,invited_by,updated_at) VALUES ($1,$2,$3,'SALES','INVITED',$4,now())`,
  [repId, "rep@radx.app", "Rep One", adminId],
);
await db.query(
  `INSERT INTO "invites"(id,email,role,token,invited_by,expires_at) VALUES ($1,$2,'SALES',$3,$4,$5)`,
  [randomUUID(), "rep@radx.app", token, adminId, expiresAt],
);
await db.query("COMMIT");
const invited = (await db.query('SELECT * FROM "users" WHERE id=$1', [repId])).rows[0];
check("invite: user row is INVITED with no password", invited.status === "INVITED" && invited.password_hash === null);

// 4. duplicate token is rejected
try {
  await db.query(
    `INSERT INTO "invites"(id,email,role,token,invited_by,expires_at) VALUES ($1,$2,'SALES',$3,$4,$5)`,
    [randomUUID(), "other@radx.app", token, adminId, expiresAt],
  );
  check("unique invites.token", false);
} catch { check("unique invites.token", true); }

// 5. accept the invite in one transaction
const repHash = await bcrypt.hash("a-long-enough-password", 12);
await db.query("BEGIN");
await db.query(`UPDATE "users" SET password_hash=$1, status='ACTIVE', updated_at=now() WHERE id=$2`, [repHash, repId]);
await db.query(`UPDATE "invites" SET accepted_at=$1 WHERE token=$2`, [now(), token]);
await db.query("COMMIT");
const active = (await db.query('SELECT * FROM "users" WHERE id=$1', [repId])).rows[0];
const consumed = (await db.query('SELECT * FROM "invites" WHERE token=$1', [token])).rows[0];
check("accept: user is ACTIVE with a usable password", active.status === "ACTIVE" && await bcrypt.compare("a-long-enough-password", active.password_hash));
check("accept: invite is consumed", consumed.accepted_at !== null);

// 6. the money chain: client -> contract -> bill -> commission
const clientId = randomUUID(), contractId = randomUUID(), billId = randomUUID();
await db.query(`INSERT INTO "clients"(id,name,type,acquired_by,status,updated_at) VALUES ($1,'Bar Rei','BAR',$2,'ACTIVE',now())`, [clientId, repId]);
await db.query(
  `INSERT INTO "contracts"(id,client_id,sales_owner_id,commission_percentage,start_date,status,updated_at) VALUES ($1,$2,$3,7.50,now(),'ACTIVE',now())`,
  [contractId, clientId, repId],
);
await db.query(
  `INSERT INTO "bills"(id,contract_id,client_id,bill_number,amount,bill_date,entered_by,status,updated_at) VALUES ($1,$2,$3,'F-001',120000.00,now(),$4,'VERIFIED',now())`,
  [billId, contractId, clientId, repId],
);
await db.query(
  `INSERT INTO "commissions"(id,bill_id,contract_id,sales_user_id,commission_percentage_snapshot,base_amount,commission_amount) VALUES ($1,$2,$3,$4,7.50,120000.00,9000.00)`,
  [randomUUID(), billId, contractId, repId],
);
const com = (await db.query('SELECT * FROM "commissions" WHERE bill_id=$1', [billId])).rows[0];
check("chain: decimals keep 2dp", com.commission_percentage_snapshot === "7.50" && com.commission_amount === "9000.00");
check("chain: commission defaults to PENDING", com.status === "PENDING");

// 7. one commission per bill
try {
  await db.query(
    `INSERT INTO "commissions"(id,bill_id,contract_id,sales_user_id,commission_percentage_snapshot,base_amount,commission_amount) VALUES ($1,$2,$3,$4,7.50,1,1)`,
    [randomUUID(), billId, contractId, repId],
  );
  check("commissions are 1:1 with bills", false);
} catch { check("commissions are 1:1 with bills", true); }

// 8. FKs hold
try {
  await db.query(`INSERT INTO "contracts"(id,client_id,sales_owner_id,commission_percentage,start_date,updated_at) VALUES ($1,$2,$3,5,now(),now())`, [randomUUID(), randomUUID(), repId]);
  check("FK contracts.client_id", false);
} catch { check("FK contracts.client_id", true); }

// 9. a user who owns rows cannot be hard-deleted (soft-delete only, per the plan)
try {
  await db.query('DELETE FROM "users" WHERE id=$1', [repId]);
  check("users with rows cannot be hard-deleted", false);
} catch { check("users with rows cannot be hard-deleted", true); }

// 9b. Phase 3: audit_logs is append-only history, not a relation
const auditId = randomUUID();
await db.query(
  `INSERT INTO "audit_logs"(id,actor_id,entity_type,entity_id,action,diff,ip_address)
   VALUES ($1,$2,'COMMISSION',$3,'DELETE',$4,'203.0.113.7')`,
  [auditId, adminId, randomUUID(), JSON.stringify({ before: { commissionAmount: "9000.00" } })],
);
const audit = (await db.query('SELECT * FROM "audit_logs" WHERE id=$1', [auditId])).rows[0];
check("audit: diff is stored as jsonb", audit.diff.before.commissionAmount === "9000.00");
check(
  "audit: entity_id is free of a foreign key, so a deleted commission keeps its entry",
  audit.entity_id !== null,
);

try {
  await db.query(
    `INSERT INTO "audit_logs"(id,entity_type,entity_id,action) VALUES ($1,'BILL',$2,'VERIFY')`,
    [randomUUID(), randomUUID()],
  );
  check("audit: a system action may have no actor", true);
} catch { check("audit: a system action may have no actor", false); }

// 9c. Phase 5: notifications and revenue_summaries
const notificationId = randomUUID();
await db.query(
  `INSERT INTO "notifications"(id,user_id,type,title,body,entity_type,entity_id)
   VALUES ($1,$2,'COMMISSION_APPROVED','Komisioni u aprovua','9000.00','COMMISSION',$3)`,
  [notificationId, adminId, randomUUID()],
);
const notification = (await db.query('SELECT * FROM "notifications" WHERE id=$1', [notificationId])).rows[0];
check("notifications: a new row starts unread", notification.read_at === null);

const periodMonth = "2026-09-01";
await db.query(
  `INSERT INTO "revenue_summaries"(id,grain,subject_id,period_month,revenue,bill_count)
   VALUES ($1,'CLIENT',$2,$3,120000.00,2)`,
  [randomUUID(), "client-1", periodMonth],
);
try {
  await db.query(
    `INSERT INTO "revenue_summaries"(id,grain,subject_id,period_month,revenue,bill_count)
     VALUES ($1,'CLIENT',$2,$3,1.00,1)`,
    [randomUUID(), "client-1", periodMonth],
  );
  check("revenue_summaries: one row per grain/subject/month", false);
} catch { check("revenue_summaries: one row per grain/subject/month", true); }

const summary = (await db.query(`SELECT * FROM "revenue_summaries" WHERE subject_id='client-1'`)).rows[0];
check("revenue_summaries: commission columns default to zero", Number(summary.commission_amount) === 0);

// The bell belongs to its user: deleting the user takes the feed with it, unlike
// audit_logs, which survives with a null actor.
check(
  "notifications: user_id cascades on delete",
  (await db.query(
    `SELECT confdeltype FROM pg_constraint WHERE conname='notifications_user_id_fkey'`,
  )).rows[0]?.confdeltype === "c",
);

// 9d. Phase 6: notification_preferences — a missing row is the default
const prefId = randomUUID();
await db.query(
  `INSERT INTO "notification_preferences"(id,user_id,type,updated_at) VALUES ($1,$2,'COMMISSION_APPROVED',now())`,
  [prefId, adminId],
);
const pref = (await db.query('SELECT * FROM "notification_preferences" WHERE id=$1', [prefId])).rows[0];
check(
  "preferences: the row defaults to what every user already had",
  pref.in_app === true && pref.email === "INSTANT",
);

try {
  await db.query(
    `INSERT INTO "notification_preferences"(id,user_id,type,updated_at) VALUES ($1,$2,'COMMISSION_APPROVED',now())`,
    [randomUUID(), adminId],
  );
  check("preferences: one row per user and type", false);
} catch { check("preferences: one row per user and type", true); }

// 10. enum values are the ones the plan lists
const enums = (await db.query(`SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) vals FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid GROUP BY 1 ORDER BY 1`)).rows;
const expected = {
  AuditEntityType: "CONTRACT,BILL,CLIENT,USER,COMMISSION",
  NotificationType:
    "CONTRACT_EXPIRING,CONTRACT_EXPIRED,BILL_DISPUTED,COMMISSION_APPROVED,COMMISSION_PAID,INVITE_ACCEPTED",
  SummaryGrain: "CLIENT,SALES_REP",
  EmailDelivery: "OFF,INSTANT,DIGEST",
  BillStatus: "PENDING,VERIFIED,DISPUTED,VOID",
  ClientStatus: "LEAD,ACTIVE,INACTIVE,LOST",
  ClientType: "BAR,RESTAURANT,HOTEL,HOME,OFFICE,OTHER",
  CommissionStatus: "PENDING,APPROVED,PAID",
  ContractStatus: "DRAFT,ACTIVE,EXPIRED,TERMINATED,RENEWED",
  UserRole: "SUPER_ADMIN,SALES,OUTSIDE_SALES",
  UserStatus: "ACTIVE,INVITED,SUSPENDED",
};
for (const row of enums) {
  check(`enum ${row.typname}`, row.vals.join(",") === expected[row.typname]);
}

await db.end();
console.log(ok.map((n) => `  PASS  ${n}`).join("\n"));
if (fail.length) console.log(fail.map((n) => `  FAIL  ${n}`).join("\n"));
console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
