CREATE TABLE "schat_checklist_personal_state" (
  "userId" INTEGER NOT NULL,
  "checklistId" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "updatedAt" BIGINT NOT NULL,
  "expiresAt" BIGINT NOT NULL,
  PRIMARY KEY ("userId", "checklistId")
);
CREATE INDEX "schat_checklist_personal_state_expiry" ON "schat_checklist_personal_state"("expiresAt");
