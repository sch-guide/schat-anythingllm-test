import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("a report is deleted from its detail view after a confirmation", () => {
  const reports = src("./sections/Reports.jsx");
  const detail = reports.slice(
    reports.indexOf("function ReportDetail"),
    reports.indexOf("function DeleteReportDialog")
  );
  const list = reports.slice(
    reports.indexOf("function ReportList"),
    reports.indexOf("function ReportDetail")
  );
  // no delete button repeated in the list; one in the detail's danger zone
  assert.doesNotMatch(list, /신고 삭제/);
  assert.match(detail, /data-testid="report-danger"/);
  assert.match(detail, /위험 영역/);
  assert.match(detail, /setConfirmDelete\(true\)/);
  const dialog = reports.slice(reports.indexOf("function DeleteReportDialog"));
  assert.match(dialog, /문제 신고를 삭제하시겠습니까\?/);
  for (const label of ["제목", "신고자", "등록일"])
    assert.match(dialog, new RegExp(label));
  assert.match(dialog, /삭제 후 복구할 수 없습니다/);
  assert.match(dialog, /SchatAccount\.deleteReport\(report\.id\)/);
  // after deleting, the list reloads and the detail closes
  assert.match(
    list,
    /onDeleted=\{\(\) => \{\s*setSelected\(null\);\s*load\(\);/
  );
  const model = src("../../models/schatAccount.js");
  assert.match(
    model,
    /deleteReport: \(id\) =>\s*call\(`\/schat-admin\/reports\/\$\{id\}`, \{ method: "DELETE" \}\)/
  );
});

test("mobile citations open a full-screen PDF/텍스트 source view", () => {
  const dir =
    "../../components/WorkspaceChat/ChatContainer/ChatHistory/Citation/";
  const row = src(`${dir}index.jsx`);
  const screen = src(`${dir}MobileSourceScreen.jsx`);
  const canvas = src(`${dir}PdfPageCanvas.jsx`);
  // PC keeps the inline viewer; mobile opens the dedicated screen instead
  assert.match(row, /!isMobile && isOpen && \(excerpt \|\| source\?\.pdfRef\)/);
  assert.match(row, /isMobile && mobileOpen && \(\s*<MobileSourceScreen/);
  // header: back to chat, source name/page, both tabs always visible
  assert.match(screen, /채팅으로/);
  assert.match(screen, /PDF 원문/);
  assert.match(screen, /텍스트 원문/);
  assert.match(screen, /role="tablist"/);
  assert.match(screen, /useState\(hasPdf \? "pdf" : "text"\)/);
  assert.match(screen, /원본 PDF를 불러올 수 없어 텍스트 근거를 표시합니다\./);
  // browser back closes the view (one history entry, router state kept)
  assert.match(
    screen,
    /window\.history\.pushState\(\s*\{ \.\.\.\(window\.history\.state \|\| \{\}\), \[HISTORY_FLAG\]: true \}/
  );
  assert.match(screen, /addEventListener\("popstate", onPop\)/);
  // no duplicate links inside the mobile view
  assert.doesNotMatch(screen, /새 창에서 열기|텍스트 원문으로 보기/);
  // the PDF still comes from the authenticated original-PDF endpoint
  assert.match(canvas, /StorageFiles\.originalPdf\(workspaceSlug, pdfRef\)/);
  assert.match(canvas, /isEvalSupported: false/);
  assert.match(screen, /lazy\(\(\) => import\("\.\/PdfPageCanvas"\)\)/);
});

test("the user icon is slightly larger but keeps its design", () => {
  const button = src("../../components/UserMenu/UserButton/index.jsx");
  assert.match(button, /<UserCircle size=\{26\} weight="regular"/);
  assert.match(button, /w-\[35px\] h-\[35px\] rounded-full/);
  const bell = src("../../components/SchatAccount/NotificationBell.jsx");
  assert.match(bell, /w-\[35px\] h-\[35px\] rounded-full/);
});

test("PC citation: text view is a toggle and the PDF can be shown again", () => {
  const dir =
    "../../components/WorkspaceChat/ChatContainer/ChatHistory/Citation/";
  const row = src(`${dir}index.jsx`);
  const viewer = src(`${dir}PdfPageViewer.jsx`);
  // 텍스트 원문으로 보기 switches the view instead of marking the PDF broken
  assert.match(viewer, /onShowText \? onShowText\(\) : onUnavailable\?\.\(\)/);
  assert.match(row, /onShowText=\{\(\) => setTextMode\(true\)\}/);
  assert.match(row, /const showPdf = pdfAvailable && !textMode;/);
  // the text view offers the way back whenever the PDF exists
  assert.match(
    row,
    /\{pdfAvailable && \(\s*<button[\s\S]*?setTextMode\(false\)[\s\S]*?PDF 원문으로 보기/
  );
});

test("an FAQ is deleted from its edit form after a confirmation", () => {
  const reports = src("./sections/Reports.jsx");
  const manager = reports.slice(
    reports.indexOf("function FaqManager"),
    reports.indexOf("function DeleteFaqDialog")
  );
  // only shown when editing an existing FAQ, never in the list rows
  assert.match(
    manager,
    /\{form\.id && \(\s*<section[\s\S]*?data-testid="faq-danger"/
  );
  assert.match(manager, /FAQ 삭제/);
  const dialog = reports.slice(reports.indexOf("function DeleteFaqDialog"));
  assert.match(dialog, /FAQ를 삭제하시겠습니까\?/);
  assert.match(dialog, /복구할 수 없습니다/);
  assert.match(dialog, /SchatAccount\.deleteFaq\(faq\.id\)/);
  assert.doesNotMatch(manager + dialog, /`[^`\n]*직원에게/);
  const model = src("../../models/schatAccount.js");
  assert.match(
    model,
    /deleteFaq: \(id\) => call\(`\/schat-admin\/faq\/\$\{id\}`, \{ method: "DELETE" \}\)/
  );
});
