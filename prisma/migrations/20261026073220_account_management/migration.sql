-- Phase 4: account management. Additive and data-preserving: existing accounts keep every value,
-- get an opening-balance date backfilled from their creation day, and stay active.

-- CreateEnum
CREATE TYPE "account_color" AS ENUM ('green', 'blue', 'amber', 'purple', 'coral', 'slate');

-- AlterEnum (new value only; it is not referenced elsewhere in this migration)
ALTER TYPE "account_type" ADD VALUE 'savings' AFTER 'bank';

-- Account names are no longer unique per user: two accounts may legitimately share a name, and an
-- archived account's name must be reusable. Replaced by a plain ownership/status index below.
DROP INDEX "accounts_user_id_name_key";

-- AlterTable
ALTER TABLE "accounts"
  ADD COLUMN "archived_at" TIMESTAMPTZ(3),
  ADD COLUMN "color" "account_color",
  ADD COLUMN "credit_limit_minor" BIGINT,
  ADD COLUMN "institution" VARCHAR(100),
  ADD COLUMN "opening_balance_date" DATE;

-- Backfill: existing accounts open on the day they were created, in their owner's time zone.
UPDATE "accounts" AS a
SET "opening_balance_date" = (a."created_at" AT TIME ZONE u."timezone")::date
FROM "users" AS u
WHERE u."id" = a."user_id";

ALTER TABLE "accounts" ALTER COLUMN "opening_balance_date" SET NOT NULL;

-- CreateIndex
CREATE INDEX "accounts_user_id_archived_at_idx" ON "accounts"("user_id", "archived_at");

-- -----------------------------------------------------------------------------
-- Integrity rules that Prisma Schema Language cannot express (see docs/database-design.md).
-- -----------------------------------------------------------------------------
ALTER TABLE "accounts"
  -- A credit limit is positive and exists only on credit cards.
  ADD CONSTRAINT "accounts_credit_limit_check" CHECK (
    "credit_limit_minor" IS NULL OR ("credit_limit_minor" > 0 AND "type" = 'credit_card')
  ),
  ADD CONSTRAINT "accounts_institution_not_blank_check" CHECK (
    "institution" IS NULL OR btrim("institution") <> ''
  ),
  ADD CONSTRAINT "accounts_opening_balance_date_check" CHECK ("opening_balance_date" >= DATE '1900-01-01'),
  ADD CONSTRAINT "accounts_archived_after_creation_check" CHECK (
    "archived_at" IS NULL OR "archived_at" >= "created_at"
  );
