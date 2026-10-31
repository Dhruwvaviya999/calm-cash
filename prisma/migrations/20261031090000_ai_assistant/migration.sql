-- Phase 10: AI assistant and financial intelligence. Additive and data-preserving: one enum and
-- five new tables (preferences, conversations, messages, merchant rules, dismissals). No existing
-- table, column, or row changes, and nothing here holds or moves money.

-- CreateEnum
CREATE TYPE "ai_message_role" AS ENUM ('user', 'assistant');

-- CreateTable
CREATE TABLE "ai_preferences" (
    "user_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ai_message_role" NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "follow_ups" VARCHAR(160)[] DEFAULT ARRAY[]::VARCHAR(160)[],
    "outcome" VARCHAR(20),
    "narrative" VARCHAR(10),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_merchant_rules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pattern_key" VARCHAR(120) NOT NULL,
    "merchant" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_merchant_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_dismissals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "subject_key" VARCHAR(200) NOT NULL,
    "value" VARCHAR(200) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_updated_at_idx" ON "ai_conversations"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_messages_user_id_idx" ON "ai_messages"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_merchant_rules_user_id_pattern_key_key" ON "ai_merchant_rules"("user_id", "pattern_key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_dismissals_user_id_kind_subject_key_value_key" ON "ai_dismissals"("user_id", "kind", "subject_key", "value");

-- AddForeignKey
ALTER TABLE "ai_preferences" ADD CONSTRAINT "ai_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_merchant_rules" ADD CONSTRAINT "ai_merchant_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_dismissals" ADD CONSTRAINT "ai_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Integrity rules Prisma cannot express.
-- -----------------------------------------------------------------------------
ALTER TABLE "ai_conversations"
  ADD CONSTRAINT "ai_conversations_title_not_blank_check" CHECK (btrim("title") <> '');

ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_blocks_array_check" CHECK (jsonb_typeof("blocks") = 'array'),
  ADD CONSTRAINT "ai_messages_follow_ups_check" CHECK (
    cardinality("follow_ups") <= 3 AND array_position("follow_ups", NULL) IS NULL
  ),
  -- Only assistant messages carry an outcome and a narrative source.
  ADD CONSTRAINT "ai_messages_outcome_check" CHECK (
    ("role" = 'assistant' OR ("outcome" IS NULL AND "narrative" IS NULL))
    AND ("outcome" IS NULL OR "outcome" IN ('answered', 'clarification', 'unsupported', 'unavailable'))
    AND ("narrative" IS NULL OR "narrative" IN ('assistant', 'template'))
  );

ALTER TABLE "ai_merchant_rules"
  ADD CONSTRAINT "ai_merchant_rules_pattern_key_format_check" CHECK ("pattern_key" ~ '^[a-z0-9 ]+$'),
  ADD CONSTRAINT "ai_merchant_rules_merchant_not_blank_check" CHECK (btrim("merchant") <> '');

ALTER TABLE "ai_dismissals"
  ADD CONSTRAINT "ai_dismissals_kind_check" CHECK (
    "kind" IN ('category', 'merchant', 'recurring_candidate', 'insight')
  ),
  ADD CONSTRAINT "ai_dismissals_subject_key_format_check" CHECK ("subject_key" ~ '^[A-Za-z0-9:._ -]+$');
