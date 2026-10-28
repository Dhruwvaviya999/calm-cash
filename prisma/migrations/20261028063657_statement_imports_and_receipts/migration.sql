-- Phase 8: statement imports and receipts. Additive and data-preserving: three new enums and
-- three new tables. No existing table, column, or constraint changes; imported transactions are
-- ordinary rows of `transactions`.

-- CreateEnum
CREATE TYPE "import_batch_status" AS ENUM ('mapping', 'reviewing', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "import_row_status" AS ENUM ('invalid', 'review', 'ready', 'matched', 'imported', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "statement_direction" AS ENUM ('debit', 'credit');

-- CreateTable
CREATE TABLE "statement_imports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "file_name" VARCHAR(120) NOT NULL,
    "format" VARCHAR(10) NOT NULL DEFAULT 'csv',
    "delimiter" VARCHAR(1) NOT NULL,
    "has_header_row" BOOLEAN NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "import_batch_status" NOT NULL DEFAULT 'mapping',
    "columns" VARCHAR(500)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(500)[],
    "settings" JSONB,
    "period_start" DATE,
    "period_end" DATE,
    "opening_balance_minor" BIGINT,
    "closing_balance_minor" BIGINT,
    "reconciled_at" TIMESTAMPTZ(3),
    "reconciliation_difference_minor" BIGINT,
    "adjustment_transaction_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_import_rows" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "cells" VARCHAR(500)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(500)[],
    "status" "import_row_status" NOT NULL,
    "occurred_on" DATE,
    "amount_minor" BIGINT,
    "direction" "statement_direction",
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "reference" VARCHAR(500),
    "counterparty" VARCHAR(500),
    "description_key" VARCHAR(120),
    "problems" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "proposal" JSONB,
    "duplicates" JSONB NOT NULL DEFAULT '[]',
    "duplicate_dismissed" BOOLEAN NOT NULL DEFAULT false,
    "matched_transaction_id" UUID,
    "imported_transaction_id" UUID,
    "error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "statement_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_receipts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "storage_key" CHAR(32) NOT NULL,
    "file_name" VARCHAR(120) NOT NULL,
    "content_type" VARCHAR(32) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transaction_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "statement_imports_user_id_created_at_idx" ON "statement_imports"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "statement_imports_account_id_idx" ON "statement_imports"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "statement_import_rows_imported_transaction_id_key" ON "statement_import_rows"("imported_transaction_id");

-- CreateIndex
CREATE INDEX "statement_import_rows_batch_id_status_idx" ON "statement_import_rows"("batch_id", "status");

-- CreateIndex
CREATE INDEX "statement_import_rows_user_id_occurred_on_idx" ON "statement_import_rows"("user_id", "occurred_on");

-- CreateIndex
CREATE INDEX "statement_import_rows_matched_transaction_id_idx" ON "statement_import_rows"("matched_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "statement_import_rows_batch_id_row_number_key" ON "statement_import_rows"("batch_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "statement_import_rows_batch_id_matched_transaction_id_key" ON "statement_import_rows"("batch_id", "matched_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_receipts_storage_key_key" ON "transaction_receipts"("storage_key");

-- CreateIndex
CREATE INDEX "transaction_receipts_transaction_id_idx" ON "transaction_receipts"("transaction_id");

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_adjustment_transaction_id_fkey" FOREIGN KEY ("adjustment_transaction_id") REFERENCES "transactions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_import_rows" ADD CONSTRAINT "statement_import_rows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_import_rows" ADD CONSTRAINT "statement_import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "statement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_import_rows" ADD CONSTRAINT "statement_import_rows_matched_transaction_id_fkey" FOREIGN KEY ("matched_transaction_id") REFERENCES "transactions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_import_rows" ADD CONSTRAINT "statement_import_rows_imported_transaction_id_fkey" FOREIGN KEY ("imported_transaction_id") REFERENCES "transactions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_receipts" ADD CONSTRAINT "transaction_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_receipts" ADD CONSTRAINT "transaction_receipts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Integrity rules that Prisma Schema Language cannot express (see docs/database-design.md).
-- They only constrain the new tables.
-- -----------------------------------------------------------------------------
ALTER TABLE "statement_imports"
  ADD CONSTRAINT "statement_imports_format_check" CHECK ("format" = 'csv'),
  ADD CONSTRAINT "statement_imports_delimiter_check" CHECK ("delimiter" IN (',', ';', E'\t', '|')),
  ADD CONSTRAINT "statement_imports_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "statement_imports_file_name_not_blank_check" CHECK (btrim("file_name") <> ''),
  ADD CONSTRAINT "statement_imports_columns_check" CHECK (
    cardinality("columns") <= 40 AND array_position("columns", NULL) IS NULL
  ),
  ADD CONSTRAINT "statement_imports_period_check" CHECK (
    "period_start" IS NULL OR "period_end" IS NULL OR "period_end" >= "period_start"
  ),
  -- Final states carry their time, and only they do.
  ADD CONSTRAINT "statement_imports_lifecycle_check" CHECK (
    ("status" = 'completed') = ("completed_at" IS NOT NULL)
    AND ("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)
  );

ALTER TABLE "statement_import_rows"
  ADD CONSTRAINT "statement_import_rows_row_number_check" CHECK ("row_number" > 0),
  ADD CONSTRAINT "statement_import_rows_cells_check" CHECK (
    cardinality("cells") <= 40 AND array_position("cells", NULL) IS NULL
  ),
  ADD CONSTRAINT "statement_import_rows_amount_minor_positive_check" CHECK (
    "amount_minor" IS NULL OR "amount_minor" > 0
  ),
  -- A matched row points at the existing transaction, an imported row at the one it created, and
  -- no other row points at either; a failed row always says why.
  ADD CONSTRAINT "statement_import_rows_links_check" CHECK (
    ("status" = 'matched') = ("matched_transaction_id" IS NOT NULL)
    AND ("status" = 'imported') = ("imported_transaction_id" IS NOT NULL)
    AND ("status" <> 'failed' OR "error" IS NOT NULL)
  ),
  -- Rows that can still become transactions were read completely.
  ADD CONSTRAINT "statement_import_rows_readable_check" CHECK (
    "status" IN ('invalid', 'skipped')
    OR ("occurred_on" IS NOT NULL AND "amount_minor" IS NOT NULL AND "direction" IS NOT NULL)
  );

ALTER TABLE "transaction_receipts"
  ADD CONSTRAINT "transaction_receipts_storage_key_check" CHECK ("storage_key" ~ '^[0-9a-f]{32}$'),
  ADD CONSTRAINT "transaction_receipts_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "transaction_receipts_content_type_check" CHECK (
    "content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  ADD CONSTRAINT "transaction_receipts_size_check" CHECK ("size_bytes" BETWEEN 1 AND 10485760),
  ADD CONSTRAINT "transaction_receipts_file_name_not_blank_check" CHECK (btrim("file_name") <> '');
