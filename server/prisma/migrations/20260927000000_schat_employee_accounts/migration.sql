-- SCHAT employee accounts, departments, issue reports, notifications, FAQ.
-- Additive only: existing users keep their data and can still sign in.

-- CreateTable
CREATE TABLE "schat_departments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AlterTable
ALTER TABLE "users" ADD COLUMN "employee_number" TEXT;
ALTER TABLE "users" ADD COLUMN "display_name" TEXT;
ALTER TABLE "users" ADD COLUMN "department_id" INTEGER REFERENCES "schat_departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "password_changed_at" DATETIME;
ALTER TABLE "users" ADD COLUMN "last_login_at" DATETIME;
ALTER TABLE "users" ADD COLUMN "disabled_at" DATETIME;

-- CreateTable
CREATE TABLE "schat_issue_reports" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reporter_user_id" INTEGER NOT NULL,
    "reporter_name" TEXT,
    "employee_number" TEXT,
    "department_name" TEXT,
    "reporter_role" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "related_feature" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "handled_by_user_id" INTEGER,
    "in_progress_at" DATETIME,
    "resolved_at" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schat_issue_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "schat_issue_reports_handled_by_user_id_fkey" FOREIGN KEY ("handled_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schat_user_notifications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "report_id" INTEGER,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read_at" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schat_user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "schat_user_notifications_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "schat_issue_reports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schat_faq_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "keywords" TEXT,
    "problem" TEXT,
    "solution" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "source_report_id" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "schat_faq_items_source_report_id_fkey" FOREIGN KEY ("source_report_id") REFERENCES "schat_issue_reports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_number_key" ON "users"("employee_number");
CREATE UNIQUE INDEX "schat_departments_name_key" ON "schat_departments"("name");
CREATE INDEX "schat_issue_reports_reporter_user_id_idx" ON "schat_issue_reports"("reporter_user_id");
CREATE INDEX "schat_issue_reports_status_idx" ON "schat_issue_reports"("status");
CREATE INDEX "schat_user_notifications_user_id_read_at_idx" ON "schat_user_notifications"("user_id", "read_at");
