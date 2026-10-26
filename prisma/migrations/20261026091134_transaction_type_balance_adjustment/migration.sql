-- Phase 5: balance adjustments (reconciliation) as their own transaction type. Additive.
--
-- This lives in its own migration on purpose: PostgreSQL cannot use an enum value in the same
-- transaction that added it, and the next migration's CHECK constraints refer to it.

-- AlterEnum
ALTER TYPE "transaction_type" ADD VALUE 'balance_adjustment';
