-- Add only the approved answer-feedback table. Existing tables/data stay intact.
CREATE TABLE "schat_answer_feedback" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "chatId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "feedback" BOOLEAN NOT NULL,
  "reason" TEXT,
  "memo" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "resolvedAt" BIGINT,
  CONSTRAINT "schat_answer_feedback_reason_check" CHECK (
    ("feedback" = 1 AND "reason" IS NULL AND "memo" IS NULL) OR
    ("feedback" = 0 AND "reason" IN ('wrong', 'not_found'))
  ),
  CONSTRAINT "schat_answer_feedback_memo_check" CHECK ("memo" IS NULL OR length("memo") <= 200),
  CONSTRAINT "schat_answer_feedback_status_check" CHECK ("status" IN ('open', 'resolved'))
);
CREATE UNIQUE INDEX "schat_answer_feedback_userId_chatId_key" ON "schat_answer_feedback"("userId", "chatId");
CREATE INDEX "schat_answer_feedback_reason_status_idx" ON "schat_answer_feedback"("reason", "status");
