-- Phase 7: budgets, recurring schedules, subscriptions, and savings goals. Additive and
-- data-preserving: existing budgets get no description, the default 80 % alert, and stay active;
-- every other change is a new table. No existing row, column, or constraint changes.

-- CreateEnum
CREATE TYPE "recurring_frequency" AS ENUM ('weekly', 'monthly', 'yearly');

-- CreateEnum
CREATE TYPE "occurrence_state" AS ENUM ('postponed', 'recorded', 'skipped', 'paused');

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "alert_thresholds_bp" INTEGER[] NOT NULL DEFAULT ARRAY[8000]::INTEGER[],
ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "description" VARCHAR(500);

-- CreateTable
CREATE TABLE "recurring_schedules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "transaction_type" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "account_id" UUID,
    "category_id" UUID,
    "merchant" VARCHAR(120),
    "payment_method" "payment_method",
    "notes" VARCHAR(2000),
    "frequency" "recurring_frequency" NOT NULL,
    "interval" SMALLINT NOT NULL DEFAULT 1,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "reminder_days" SMALLINT,
    "next_occurrence_date" DATE,
    "is_subscription" BOOLEAN NOT NULL DEFAULT false,
    "paused_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recurring_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_occurrences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "state" "occurrence_state" NOT NULL,
    "transaction_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scheduled_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "target_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "target_date" DATE,
    "paused_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "savings_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_contributions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "contributed_on" DATE NOT NULL,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "goal_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_schedules_user_id_archived_at_idx" ON "recurring_schedules"("user_id", "archived_at");

-- CreateIndex
CREATE INDEX "recurring_schedules_account_id_idx" ON "recurring_schedules"("account_id");

-- CreateIndex
CREATE INDEX "recurring_schedules_category_id_idx" ON "recurring_schedules"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_occurrences_transaction_id_key" ON "scheduled_occurrences"("transaction_id");

-- CreateIndex
CREATE INDEX "scheduled_occurrences_user_id_due_date_idx" ON "scheduled_occurrences"("user_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_occurrences_schedule_id_scheduled_date_key" ON "scheduled_occurrences"("schedule_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "savings_goals_user_id_archived_at_idx" ON "savings_goals"("user_id", "archived_at");

-- CreateIndex
CREATE INDEX "goal_contributions_goal_id_contributed_on_idx" ON "goal_contributions"("goal_id", "contributed_on");

-- AddForeignKey
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_occurrences" ADD CONSTRAINT "scheduled_occurrences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_occurrences" ADD CONSTRAINT "scheduled_occurrences_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "recurring_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_occurrences" ADD CONSTRAINT "scheduled_occurrences_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "savings_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Integrity rules that Prisma Schema Language cannot express (see docs/database-design.md).
-- They only constrain new columns and new tables, so no existing row can violate them.
-- -----------------------------------------------------------------------------
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_description_not_blank_check" CHECK (
    "description" IS NULL OR btrim("description") <> ''
  ),
  -- Up to three alerts, each between 1 % and 99 % of the limit (the limit itself is always shown).
  -- Their ascending order is enforced by the API.
  ADD CONSTRAINT "budgets_alert_thresholds_check" CHECK (
    cardinality("alert_thresholds_bp") <= 3
    AND array_position("alert_thresholds_bp", NULL) IS NULL
    AND 100 <= ALL ("alert_thresholds_bp")
    AND 9900 >= ALL ("alert_thresholds_bp")
  ),
  ADD CONSTRAINT "budgets_archived_after_creation_check" CHECK (
    "archived_at" IS NULL OR "archived_at" >= "created_at"
  );

ALTER TABLE "recurring_schedules"
  ADD CONSTRAINT "recurring_schedules_type_check" CHECK ("type" IN ('income', 'expense')),
  ADD CONSTRAINT "recurring_schedules_amount_minor_positive_check" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "recurring_schedules_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "recurring_schedules_name_not_blank_check" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "recurring_schedules_merchant_not_blank_check" CHECK (
    "merchant" IS NULL OR btrim("merchant") <> ''
  ),
  ADD CONSTRAINT "recurring_schedules_notes_not_blank_check" CHECK (
    "notes" IS NULL OR btrim("notes") <> ''
  ),
  ADD CONSTRAINT "recurring_schedules_interval_check" CHECK ("interval" BETWEEN 1 AND 52),
  ADD CONSTRAINT "recurring_schedules_reminder_days_check" CHECK (
    "reminder_days" IS NULL OR "reminder_days" BETWEEN 0 AND 60
  ),
  ADD CONSTRAINT "recurring_schedules_date_range_check" CHECK (
    "start_date" >= DATE '1900-01-01' AND ("end_date" IS NULL OR "end_date" >= "start_date")
  ),
  ADD CONSTRAINT "recurring_schedules_cursor_check" CHECK (
    "next_occurrence_date" IS NULL OR "next_occurrence_date" >= "start_date"
  ),
  -- A subscription is always an expense; only subscriptions are cancelled, and a cancelled one
  -- has an end date after which nothing is expected.
  ADD CONSTRAINT "recurring_schedules_subscription_check" CHECK (
    (NOT "is_subscription" OR "type" = 'expense')
    AND ("cancelled_at" IS NULL OR ("is_subscription" AND "end_date" IS NOT NULL))
  ),
  ADD CONSTRAINT "recurring_schedules_lifecycle_check" CHECK (
    ("paused_at" IS NULL OR "paused_at" >= "created_at")
    AND ("archived_at" IS NULL OR "archived_at" >= "created_at")
    AND ("cancelled_at" IS NULL OR "cancelled_at" >= "created_at")
  );

ALTER TABLE "scheduled_occurrences"
  -- Postponing only ever moves a due date later.
  ADD CONSTRAINT "scheduled_occurrences_due_date_check" CHECK ("due_date" >= "scheduled_date"),
  -- A recorded occurrence, and only a recorded one, points at its transaction; every resolved
  -- state carries the time it was resolved, a postponed (still expected) one does not.
  ADD CONSTRAINT "scheduled_occurrences_state_check" CHECK (
    ("state" = 'recorded') = ("transaction_id" IS NOT NULL)
    AND ("state" = 'postponed') = ("resolved_at" IS NULL)
  );

ALTER TABLE "savings_goals"
  ADD CONSTRAINT "savings_goals_target_minor_positive_check" CHECK ("target_minor" > 0),
  ADD CONSTRAINT "savings_goals_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "savings_goals_name_not_blank_check" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "savings_goals_description_not_blank_check" CHECK (
    "description" IS NULL OR btrim("description") <> ''
  ),
  ADD CONSTRAINT "savings_goals_target_date_check" CHECK (
    "target_date" IS NULL OR "target_date" >= DATE '1900-01-01'
  ),
  ADD CONSTRAINT "savings_goals_lifecycle_check" CHECK (
    ("paused_at" IS NULL OR "paused_at" >= "created_at")
    AND ("completed_at" IS NULL OR "completed_at" >= "created_at")
    AND ("archived_at" IS NULL OR "archived_at" >= "created_at")
  );

ALTER TABLE "goal_contributions"
  ADD CONSTRAINT "goal_contributions_amount_minor_not_zero_check" CHECK ("amount_minor" <> 0),
  ADD CONSTRAINT "goal_contributions_note_not_blank_check" CHECK (
    "note" IS NULL OR btrim("note") <> ''
  ),
  ADD CONSTRAINT "goal_contributions_contributed_on_check" CHECK (
    "contributed_on" >= DATE '1900-01-01'
  );
