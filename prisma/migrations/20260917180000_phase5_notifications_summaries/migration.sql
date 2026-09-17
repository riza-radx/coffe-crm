-- Rei CRM — Phase 5 (Polish for launch): notifications + revenue_summaries
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CONTRACT_EXPIRING', 'CONTRACT_EXPIRED', 'BILL_DISPUTED', 'COMMISSION_APPROVED', 'COMMISSION_PAID', 'INVITE_ACCEPTED');

-- CreateEnum
CREATE TYPE "SummaryGrain" AS ENUM ('CLIENT', 'SALES_REP');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "entity_type" "AuditEntityType",
    "entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The bell asks one question: "my unread, newest first".
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "revenue_summaries" (
    "id" TEXT NOT NULL,
    "grain" "SummaryGrain" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "period_month" DATE NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,
    "bill_count" INTEGER NOT NULL,
    "commission_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commission_count" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The upsert target of the nightly rollup.
CREATE UNIQUE INDEX "revenue_summaries_grain_subject_id_period_month_key" ON "revenue_summaries"("grain", "subject_id", "period_month");

-- CreateIndex
CREATE INDEX "revenue_summaries_period_month_idx" ON "revenue_summaries"("period_month");
