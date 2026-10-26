-- Phase 5: transaction management. Additive and data-preserving: existing transactions keep every
-- value, get no tags and no payment method, and stay active (not voided); existing categories stay
-- top-level and active.

-- CreateEnum
CREATE TYPE "adjustment_direction" AS ENUM ('increase', 'decrease');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'upi', 'bank_transfer', 'debit_card', 'credit_card', 'net_banking', 'cheque', 'digital_wallet', 'direct_debit', 'other');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "parent_id" UUID;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "adjustment_direction" "adjustment_direction",
ADD COLUMN     "idempotency_key" UUID,
ADD COLUMN     "payment_method" "payment_method",
ADD COLUMN     "tags" VARCHAR(32)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(32)[],
ADD COLUMN     "void_reason" VARCHAR(500),
ADD COLUMN     "voided_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "transactions_tags_idx" ON "transactions" USING GIN ("tags");

-- CreateIndex (NULL keys are distinct, so requests without a key never collide)
CREATE UNIQUE INDEX "transactions_user_id_idempotency_key_key" ON "transactions"("user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Integrity rules that Prisma Schema Language cannot express (see docs/database-design.md).
-- They only constrain the new columns and the new transaction type, so no existing row can
-- violate them.
-- -----------------------------------------------------------------------------
ALTER TABLE "transactions"
  -- A balance adjustment, and only an adjustment, has a direction. It is never categorised and
  -- has no counterparty or payment method (`transactions_transfer_shape_check` already keeps
  -- the transfer destination off every non-transfer row).
  ADD CONSTRAINT "transactions_adjustment_shape_check" CHECK (
    ("type" = 'balance_adjustment') = ("adjustment_direction" IS NOT NULL)
    AND (
      "type" <> 'balance_adjustment'
      OR ("category_id" IS NULL AND "merchant" IS NULL AND "payment_method" IS NULL)
    )
  ),
  ADD CONSTRAINT "transactions_tags_check" CHECK (
    cardinality("tags") <= 10 AND array_position("tags", NULL) IS NULL
  ),
  -- A void reason only exists on a voided row, and nothing is voided before it was recorded.
  ADD CONSTRAINT "transactions_void_check" CHECK (
    ("voided_at" IS NULL AND "void_reason" IS NULL)
    OR ("voided_at" IS NOT NULL AND "voided_at" >= "created_at")
  ),
  ADD CONSTRAINT "transactions_void_reason_not_blank_check" CHECK (
    "void_reason" IS NULL OR btrim("void_reason") <> ''
  );

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_parent_not_self_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  ADD CONSTRAINT "categories_archived_after_creation_check" CHECK (
    "archived_at" IS NULL OR "archived_at" >= "created_at"
  );
