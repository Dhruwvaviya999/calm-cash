-- Phase 12: abuse-limit counters shared by every API instance (replaces per-process memory).

-- CreateTable
CREATE TABLE "rate_limit_counters" (
    "key" CHAR(64) NOT NULL,
    "hits" INTEGER NOT NULL,
    "reset_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limit_counters_reset_at_idx" ON "rate_limit_counters"("reset_at");

-- Keys are lower-case SHA-256 hex digests; counts never go negative.
ALTER TABLE "rate_limit_counters"
    ADD CONSTRAINT "rate_limit_counters_key_check" CHECK ("key" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "rate_limit_counters_hits_check" CHECK ("hits" >= 0);
