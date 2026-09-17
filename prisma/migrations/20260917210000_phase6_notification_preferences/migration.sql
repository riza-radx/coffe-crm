-- Rei CRM — Phase 6 (Post-MVP): notification_preferences
-- CreateEnum
CREATE TYPE "EmailDelivery" AS ENUM ('OFF', 'INSTANT', 'DIGEST');

-- CreateTable
-- A missing row is the default (in-app on, email instant), so this table starts
-- empty and nothing changes for a user who never opens the settings.
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" "EmailDelivery" NOT NULL DEFAULT 'INSTANT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_type_key" ON "notification_preferences"("user_id", "type");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
