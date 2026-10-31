-- Phase 9: notifications, reminders, and background automation. Additive and data-preserving:
-- four new enums and five new tables. No existing table, column, or constraint changes; existing
-- users get the documented notification defaults without a row (one is created on their first
-- change). Nothing here can create a transaction or change a balance.
-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('budget_approaching_limit', 'budget_limit_reached', 'recurring_payment_upcoming', 'recurring_payment_due', 'recurring_payment_overdue', 'subscription_renewal_upcoming', 'monthly_summary_ready', 'email_delivery_problem');

-- CreateEnum
CREATE TYPE "delivery_channel" AS ENUM ('email');

-- CreateEnum
CREATE TYPE "notification_delivery_status" AS ENUM ('pending', 'processing', 'sent', 'retry_scheduled', 'failed', 'suppressed');

-- CreateEnum
CREATE TYPE "automation_job_status" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "budget_alerts_in_app" BOOLEAN NOT NULL DEFAULT true,
    "budget_alerts_email" BOOLEAN NOT NULL DEFAULT false,
    "upcoming_payments_in_app" BOOLEAN NOT NULL DEFAULT true,
    "upcoming_payments_email" BOOLEAN NOT NULL DEFAULT false,
    "overdue_payments_in_app" BOOLEAN NOT NULL DEFAULT true,
    "overdue_payments_email" BOOLEAN NOT NULL DEFAULT false,
    "subscription_renewals_in_app" BOOLEAN NOT NULL DEFAULT true,
    "subscription_renewals_email" BOOLEAN NOT NULL DEFAULT false,
    "monthly_summary_in_app" BOOLEAN NOT NULL DEFAULT true,
    "monthly_summary_email" BOOLEAN NOT NULL DEFAULT false,
    "payment_lead_days" SMALLINT NOT NULL DEFAULT 3,
    "subscription_lead_days" SMALLINT NOT NULL DEFAULT 3,
    "include_recurring_income" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "dedupe_key" VARCHAR(200) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "target" JSONB,
    "in_app" BOOLEAN NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "dismissed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "delivery_channel" NOT NULL DEFAULT 'email',
    "status" "notification_delivery_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "locked_by" VARCHAR(100),
    "locked_until" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(40),
    "outcome_uncertain" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_jobs" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "user_id" UUID,
    "dedupe_key" VARCHAR(200),
    "coalesce_key" VARCHAR(200),
    "payload" JSONB NOT NULL,
    "status" "automation_job_status" NOT NULL DEFAULT 'pending',
    "run_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "locked_by" VARCHAR(100),
    "locked_until" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(40),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "id" VARCHAR(100) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_user_id_status_idx" ON "notification_deliveries"("user_id", "status");

-- CreateIndex
CREATE INDEX "notification_deliveries_completed_at_idx" ON "notification_deliveries"("completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_key" ON "notification_deliveries"("notification_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "automation_jobs_dedupe_key_key" ON "automation_jobs"("dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "automation_jobs_coalesce_key_key" ON "automation_jobs"("coalesce_key");

-- CreateIndex
CREATE INDEX "automation_jobs_status_run_at_idx" ON "automation_jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "automation_jobs_user_id_idx" ON "automation_jobs"("user_id");

-- CreateIndex
CREATE INDEX "automation_jobs_completed_at_idx" ON "automation_jobs"("completed_at");

-- CreateIndex
CREATE INDEX "worker_heartbeats_last_seen_at_idx" ON "worker_heartbeats"("last_seen_at");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Integrity rules Prisma cannot express.
-- -----------------------------------------------------------------------------
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_payment_lead_days_check" CHECK ("payment_lead_days" IN (1, 3, 7)),
  ADD CONSTRAINT "notification_preferences_subscription_lead_days_check" CHECK ("subscription_lead_days" IN (1, 3, 7));

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_title_not_blank_check" CHECK (btrim("title") <> ''),
  -- Identities are built from IDs, dates, codes, and numbers only.
  ADD CONSTRAINT "notifications_dedupe_key_format_check" CHECK ("dedupe_key" ~ '^[A-Za-z0-9:._-]+$'),
  ADD CONSTRAINT "notifications_target_object_check" CHECK ("target" IS NULL OR jsonb_typeof("target") = 'object');

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_attempts_check" CHECK (
    "attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 20 AND "attempts" <= "max_attempts"
  ),
  -- A lease exists exactly while a worker processes the delivery.
  ADD CONSTRAINT "notification_deliveries_lease_check" CHECK (
    ("status" = 'processing') = ("locked_by" IS NOT NULL AND "locked_until" IS NOT NULL)
  ),
  ADD CONSTRAINT "notification_deliveries_sent_check" CHECK (("status" = 'sent') = ("sent_at" IS NOT NULL)),
  -- Final states carry their time, and only they do.
  ADD CONSTRAINT "notification_deliveries_completed_check" CHECK (
    ("status" IN ('sent', 'failed', 'suppressed')) = ("completed_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "notification_deliveries_error_code_format_check" CHECK (
    "last_error_code" IS NULL OR "last_error_code" ~ '^[a-z0-9_]+$'
  );

ALTER TABLE "automation_jobs"
  ADD CONSTRAINT "automation_jobs_kind_format_check" CHECK ("kind" ~ '^[a-z_]+$'),
  ADD CONSTRAINT "automation_jobs_payload_object_check" CHECK (jsonb_typeof("payload") = 'object'),
  ADD CONSTRAINT "automation_jobs_attempts_check" CHECK (
    "attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 20 AND "attempts" <= "max_attempts"
  ),
  ADD CONSTRAINT "automation_jobs_lease_check" CHECK (
    ("status" = 'processing') = ("locked_by" IS NOT NULL AND "locked_until" IS NOT NULL)
  ),
  ADD CONSTRAINT "automation_jobs_completed_check" CHECK (
    ("status" IN ('succeeded', 'failed', 'cancelled', 'expired')) = ("completed_at" IS NOT NULL)
  ),
  -- Only a waiting job absorbs new events.
  ADD CONSTRAINT "automation_jobs_coalesce_pending_check" CHECK ("coalesce_key" IS NULL OR "status" = 'pending'),
  ADD CONSTRAINT "automation_jobs_error_code_format_check" CHECK (
    "last_error_code" IS NULL OR "last_error_code" ~ '^[a-z0-9_]+$'
  );
