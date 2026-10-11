-- SCHAT 동의어 자동 후보의 출처 기록: new table only. Existing tables are not altered.
-- CreateTable
CREATE TABLE "schat_synonym_suggestions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "group_id" INTEGER,
    "terms" TEXT NOT NULL,
    "category" TEXT,
    "confidence" REAL,
    "reason" TEXT,
    "method" TEXT NOT NULL,
    "sources" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "schat_synonym_suggestions_group_id_idx" ON "schat_synonym_suggestions"("group_id");

-- CreateIndex
CREATE INDEX "schat_synonym_suggestions_status_idx" ON "schat_synonym_suggestions"("status");
