-- SCHAT 동의어 자동 후보 실행 결과. 새 표 1개와, 같은 작업에서 만든
-- schat_synonym_suggestions 표에 실행 번호 칸 1개를 더한다. 기존 표는 바꾸지 않는다.
-- CreateTable
CREATE TABLE "schat_synonym_suggestion_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trigger" TEXT NOT NULL,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'running',
    "summary" TEXT NOT NULL DEFAULT '{}',
    "documents" TEXT NOT NULL DEFAULT '[]',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- AlterTable
ALTER TABLE "schat_synonym_suggestions" ADD COLUMN "run_id" INTEGER;

-- CreateIndex
CREATE INDEX "schat_synonym_suggestions_run_id_idx" ON "schat_synonym_suggestions"("run_id");
