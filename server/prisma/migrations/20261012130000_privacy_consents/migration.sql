-- CreateTable
CREATE TABLE "schat_privacy_consent_documents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "published_by" INTEGER,
    "published_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "schat_privacy_consents" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "items" TEXT NOT NULL,
    "agreed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schat_privacy_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "schat_privacy_consent_documents_version_key" ON "schat_privacy_consent_documents"("version");

-- CreateIndex
CREATE INDEX "schat_privacy_consents_version_idx" ON "schat_privacy_consents"("version");

-- CreateIndex
CREATE UNIQUE INDEX "schat_privacy_consents_user_id_version_key" ON "schat_privacy_consents"("user_id", "version");

