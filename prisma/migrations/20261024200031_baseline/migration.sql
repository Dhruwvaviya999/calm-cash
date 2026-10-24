-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('cash', 'bank', 'credit_card', 'digital_wallet', 'investment', 'loan', 'other');

-- CreateEnum
CREATE TYPE "transaction_type" AS ENUM ('income', 'expense', 'transfer');

-- CreateEnum
CREATE TYPE "category_kind" AS ENUM ('income', 'expense');

-- CreateEnum
CREATE TYPE "budget_period" AS ENUM ('weekly', 'monthly', 'quarterly', 'yearly', 'custom');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "preferred_currency" CHAR(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "account_type" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "opening_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "kind" "category_kind" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "type" "transaction_type" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "merchant" VARCHAR(120),
    "category_id" UUID,
    "transfer_account_id" UUID,
    "notes" VARCHAR(2000),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category_id" UUID,
    "limit_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "period" "budget_period" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_user_id_name_key" ON "accounts"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_user_id_kind_name_key" ON "categories"("user_id", "kind", "name");

-- CreateIndex
CREATE INDEX "transactions_user_id_occurred_at_idx" ON "transactions"("user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_account_id_occurred_at_idx" ON "transactions"("account_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_transfer_account_id_idx" ON "transactions"("transfer_account_id");

-- CreateIndex
CREATE INDEX "transactions_category_id_idx" ON "transactions"("category_id");

-- CreateIndex
CREATE INDEX "budgets_user_id_idx" ON "budgets"("user_id");

-- CreateIndex
CREATE INDEX "budgets_category_id_idx" ON "budgets"("category_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_account_id_fkey" FOREIGN KEY ("transfer_account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Data-integrity rules that Prisma Schema Language cannot express.
-- Hand-written; see docs/database-design.md. They act as a last line of defence
-- behind API validation, so invalid financial data cannot be persisted even by
-- a buggy code path or a manual query.
-- -----------------------------------------------------------------------------

-- Users
ALTER TABLE "users"
  ADD CONSTRAINT "users_name_not_blank_check" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_preferred_currency_format_check" CHECK ("preferred_currency" ~ '^[A-Z]{3}$');

-- Accounts (opening balances may be negative for liabilities such as credit cards)
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_name_not_blank_check" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "accounts_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$');

-- Categories
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_name_not_blank_check" CHECK (btrim("name") <> '');

-- Transactions: amounts are strictly positive; direction comes from "type".
-- A transfer must name a different destination account and is never categorised;
-- income and expense rows must not reference a destination account.
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_minor_positive_check" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "transactions_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "transactions_description_not_blank_check" CHECK (btrim("description") <> ''),
  ADD CONSTRAINT "transactions_transfer_shape_check" CHECK (
    (
      "type" = 'transfer'
      AND "transfer_account_id" IS NOT NULL
      AND "transfer_account_id" <> "account_id"
      AND "category_id" IS NULL
    )
    OR (
      "type" <> 'transfer'
      AND "transfer_account_id" IS NULL
    )
  );

-- Budgets: positive limits and a coherent date window.
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_name_not_blank_check" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "budgets_limit_minor_positive_check" CHECK ("limit_minor" > 0),
  ADD CONSTRAINT "budgets_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "budgets_date_range_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
  ADD CONSTRAINT "budgets_custom_period_end_date_check" CHECK ("period" <> 'custom' OR "end_date" IS NOT NULL);
