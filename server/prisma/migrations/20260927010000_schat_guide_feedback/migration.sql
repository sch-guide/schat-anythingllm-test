-- 이용 가이드: FAQ usefulness counters and the FAQ a report came from.
-- Additive only.

-- AlterTable
ALTER TABLE "schat_faq_items" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "schat_faq_items" ADD COLUMN "helpful_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "schat_faq_items" ADD COLUMN "not_helpful_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "schat_issue_reports" ADD COLUMN "related_faq_id" INTEGER;
ALTER TABLE "schat_issue_reports" ADD COLUMN "related_faq_title" TEXT;
