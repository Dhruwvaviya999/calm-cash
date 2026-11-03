-- Phase 11: financial intelligence. Additive only: one table for saved what-if scenarios
-- (assumptions only; results are recalculated, never stored) and one more dismissal kind for
-- financial recommendations. No existing row is changed.

-- CreateTable
CREATE TABLE "financial_scenarios" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "horizon_days" INTEGER NOT NULL,
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financial_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_scenarios_user_id_updated_at_idx" ON "financial_scenarios"("user_id", "updated_at" DESC);

-- AddForeignKey
ALTER TABLE "financial_scenarios" ADD CONSTRAINT "financial_scenarios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written constraints (the application validates the same rules first).
ALTER TABLE "financial_scenarios"
  ADD CONSTRAINT "financial_scenarios_horizon_days_check" CHECK ("horizon_days" IN (30, 60, 90, 180, 365)),
  ADD CONSTRAINT "financial_scenarios_name_not_blank_check" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "financial_scenarios_assumptions_array_check" CHECK (jsonb_typeof("assumptions") = 'array');

-- Recommendations the person dismissed or marked as reviewed reuse the dismissal table.
ALTER TABLE "ai_dismissals" DROP CONSTRAINT "ai_dismissals_kind_check";
ALTER TABLE "ai_dismissals"
  ADD CONSTRAINT "ai_dismissals_kind_check" CHECK (
    "kind" IN ('category', 'merchant', 'recurring_candidate', 'insight', 'recommendation')
  );
