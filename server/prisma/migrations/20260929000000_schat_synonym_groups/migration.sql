-- SCHAT 동의어 사전: new table only. Existing tables are not altered.
-- CreateTable
CREATE TABLE "schat_synonym_groups" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "terms" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'procedure',
    "status" TEXT NOT NULL DEFAULT 'needs_review',
    "source" TEXT NOT NULL DEFAULT 'admin',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "schat_synonym_groups_status_idx" ON "schat_synonym_groups"("status");
