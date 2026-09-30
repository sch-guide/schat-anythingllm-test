import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file) =>
  readFileSync(new URL(`./sections/${file}`, import.meta.url), "utf8");

// Load only a pure helper from a section file (the files import React).
async function helper(file, start, end) {
  const text = source(file);
  const code = text.slice(text.indexOf(start), text.indexOf(end));
  return import(`data:text/javascript,${encodeURIComponent(code)}`);
}

test("부서 삭제 버튼은 직원 0명인 부서에만 나온다", async () => {
  const { canDeleteDepartment } = await helper(
    "UsersDepartments.jsx",
    "export function canDeleteDepartment",
    "function DeleteDepartmentDialog"
  );
  assert.equal(canDeleteDepartment({ userCount: 0 }), true);
  assert.equal(canDeleteDepartment({ userCount: 15 }), false);
  assert.equal(canDeleteDepartment({}), false);

  const page = source("UsersDepartments.jsx");
  assert.match(page, /canDeleteDepartment\(d\) && editing !== d\.id/);
  assert.match(page, /\$\{department\.name\} 부서를 삭제하시겠습니까\?/);
  assert.match(page, /이 작업은 되돌릴 수 없습니다/);
  assert.match(page, /SchatAccount\.deleteDepartment\(department\.id\)/);
  // rename and suspend/re-enable stay as they were
  assert.match(page, /이름 변경/);
  assert.match(page, /d\.active \? "사용중지" : "다시 사용"/);
});

test("원본 PDF는 따로 모아 파일별 결과와 확보 공간을 보여 준다", async () => {
  // isOriginalPdf, originalDeleteSummary and formatBytes sit together
  const { isOriginalPdf, originalDeleteSummary } = await helper(
    "Storage.jsx",
    "export function isOriginalPdf",
    "const n = (value)"
  );
  assert.equal(isOriginalPdf({ kind: "original" }), true);
  assert.equal(isOriginalPdf({ kind: "upload" }), false);
  assert.equal(
    originalDeleteSummary({
      deleted: 3,
      refused: 0,
      freedBytes: 81 * 1024 ** 2,
    }),
    "연결되지 않은 원본 PDF 3개 삭제 · 확보 공간: 약 81MB"
  );
  assert.match(
    originalDeleteSummary({ deleted: 1, refused: 2, freedBytes: 2048 }),
    /삭제하지 않음 2개/
  );

  const page = source("Storage.jsx");
  assert.match(page, /\.filter\(\(group\) => !isOriginalPdf\(group\)\)/);
  assert.match(
    page,
    /선택한 원본 PDF \$\{selected\.length\}개를 삭제하시겠습니까\?/
  );
  assert.match(page, /삭제 후 복구할 수 없습니다/);
  assert.match(page, /disabled=\{!selectable\}/);
  assert.match(page, /SchatAdmin\.storageDeleteOriginals\(selected\)/);
});

test("시스템 기록에 부서 삭제와 원본 PDF 정리가 쉬운 말로 나온다", async () => {
  const text = source("Status.jsx");
  const code =
    text.slice(
      text.indexOf("export const EVENT_LABELS"),
      text.indexOf("const CHECKLIST_ISSUE_TEXT")
    ) +
    text.slice(
      text.indexOf("export function cleanupLabel"),
      text.indexOf("function formatNumber")
    );
  const { cleanupLabel, eventLabel } = await import(
    `data:text/javascript,${encodeURIComponent(code)}`
  );
  assert.equal(eventLabel("schat_department_deleted"), "부서 삭제");
  assert.equal(
    cleanupLabel(
      "schat_department_deleted",
      JSON.stringify({ name: "E2E테스트부서" })
    ),
    " · E2E테스트부서"
  );
  assert.equal(
    cleanupLabel(
      "schat_original_pdf_cleanup",
      JSON.stringify({ deleted: 3, freedBytes: 81 * 1024 ** 2 })
    ),
    " · 3개 삭제 · 확보 공간 81MB"
  );
  assert.equal(cleanupLabel("login_event", "{}"), "");
});
