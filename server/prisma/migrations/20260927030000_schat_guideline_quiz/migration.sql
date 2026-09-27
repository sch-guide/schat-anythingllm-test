-- SCHAT 지침서 퀴즈: new tables only. Existing tables are not altered.
-- CreateTable
CREATE TABLE "schat_quiz_sets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "source_document_name" TEXT NOT NULL,
    "document_version" TEXT,
    "topic" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "question_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "schat_quiz_questions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quiz_set_id" INTEGER,
    "document_id" TEXT NOT NULL,
    "source_document_name" TEXT NOT NULL,
    "document_version" TEXT,
    "workspace_slug" TEXT,
    "source_page" INTEGER NOT NULL,
    "source_section" TEXT,
    "source_excerpt" TEXT,
    "topic" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "question_type" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "choices" TEXT,
    "correct_choice_id" TEXT,
    "correct_ox" TEXT,
    "explanation" TEXT NOT NULL,
    "review_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "generation_id" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schat_quiz_questions_quiz_set_id_fkey" FOREIGN KEY ("quiz_set_id") REFERENCES "schat_quiz_sets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schat_quiz_attempts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "department_name" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'normal',
    "filters" TEXT,
    "question_ids" TEXT NOT NULL,
    "choice_orders" TEXT,
    "total" INTEGER NOT NULL,
    "correct_count" INTEGER NOT NULL DEFAULT 0,
    "answered_count" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "schat_quiz_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schat_quiz_answers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "attempt_id" INTEGER NOT NULL,
    "question_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "selected_choice_id" TEXT,
    "selected_ox" TEXT,
    "is_correct" BOOLEAN NOT NULL,
    "answeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schat_quiz_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "schat_quiz_attempts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "schat_quiz_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "schat_quiz_questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "schat_quiz_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schat_quiz_wrong_notes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "question_id" INTEGER NOT NULL,
    "selected_choice_id" TEXT,
    "selected_ox" TEXT,
    "wrong_count" INTEGER NOT NULL DEFAULT 1,
    "lastWrongAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schat_quiz_wrong_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "schat_quiz_wrong_notes_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "schat_quiz_questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schat_quiz_generation_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "admin_id" INTEGER,
    "document_id" TEXT,
    "topic" TEXT,
    "requested" INTEGER NOT NULL,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "schat_quiz_sets_status_idx" ON "schat_quiz_sets"("status");

-- CreateIndex
CREATE INDEX "schat_quiz_questions_status_document_id_topic_idx" ON "schat_quiz_questions"("status", "document_id", "topic");

-- CreateIndex
CREATE INDEX "schat_quiz_questions_quiz_set_id_idx" ON "schat_quiz_questions"("quiz_set_id");

-- CreateIndex
CREATE INDEX "schat_quiz_attempts_user_id_startedAt_idx" ON "schat_quiz_attempts"("user_id", "startedAt");

-- CreateIndex
CREATE INDEX "schat_quiz_answers_question_id_idx" ON "schat_quiz_answers"("question_id");

-- CreateIndex
CREATE INDEX "schat_quiz_answers_user_id_answeredAt_idx" ON "schat_quiz_answers"("user_id", "answeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "schat_quiz_answers_attempt_id_question_id_key" ON "schat_quiz_answers"("attempt_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "schat_quiz_wrong_notes_user_id_question_id_key" ON "schat_quiz_wrong_notes"("user_id", "question_id");

-- CreateIndex
CREATE INDEX "schat_quiz_generation_logs_createdAt_idx" ON "schat_quiz_generation_logs"("createdAt");

