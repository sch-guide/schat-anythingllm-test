import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SOURCE_LABELS,
  confidenceText,
  countGroups,
  describeSources,
  inFilter,
} from "./synonymReview.js";

const manual = { id: 1, status: "active", source: "admin", terms: ["a", "b"] };
const auto = {
  id: 2,
  status: "needs_review",
  source: "auto",
  terms: ["c", "d"],
};
const activeWithAddition = {
  id: 3,
  status: "active",
  source: "draft",
  terms: ["HD", "혈액투석"],
  pendingAdditions: [{ id: 9, terms: ["HD therapy"] }],
};

test("automatic and manual groups are told apart", () => {
  assert.equal(SOURCE_LABELS.auto, "자동 제안");
  assert.equal(SOURCE_LABELS.admin, "직접 등록");
});

test("검토 필요 shows new suggestions and groups with words waiting to be added", () => {
  assert.equal(inFilter(auto, "needs_review"), true);
  assert.equal(inFilter(activeWithAddition, "needs_review"), true);
  assert.equal(inFilter(manual, "needs_review"), false);
  // the group's own status is unchanged: it still counts as 사용
  assert.equal(inFilter(activeWithAddition, "active"), true);
  assert.deepEqual(countGroups([manual, auto, activeWithAddition]), {
    all: 3,
    needs_review: 2,
    active: 2,
    off: 0,
  });
});

test("the source shows the document and pages for the administrator", () => {
  assert.equal(
    describeSources([
      { documentName: "검사 및 시술(26.04.07).pdf", pages: [13, 14] },
      { documentName: "old.pdf", pages: [], missing: true },
    ]),
    "검사 및 시술(26.04.07).pdf p.13, 14 · old.pdf (삭제된 문서)"
  );
  assert.equal(confidenceText(0.96), "확신도 96%");
});

test("the screen shows the badges, the source and approve/reject for additions", () => {
  const screen = readFileSync(
    new URL("./sections/Synonyms.jsx", import.meta.url),
    "utf8"
  );
  for (const text of [
    "SOURCE_LABELS[group.source]",
    "추가 후보",
    "추가 승인",
    "거절",
    "출처 없음",
    "낮은 확신",
    "분류:",
    "출처:",
    "근거:",
  ])
    assert.ok(screen.includes(text), text);
});

test("the run result shows total, new, duplicates, failures and text shortage", async () => {
  const { runTotals, RUN_TRIGGER_LABELS } = await import("./synonymReview.js");
  const totals = runTotals({
    documents: 21,
    candidates: 120,
    newGroups: 80,
    additions: 10,
    duplicates: 25,
    textShort: 2,
    failed: 1,
  });
  const byLabel = Object.fromEntries(
    totals.map((item) => [item.label, item.value])
  );
  assert.equal(byLabel["전체 후보"], 120);
  assert.equal(byLabel["새 묶음"], 80);
  assert.equal(byLabel["중복 제외"], 25);
  assert.equal(byLabel["텍스트 부족"], 2);
  assert.equal(byLabel["실패"], 1);
  assert.equal(byLabel["재시도"], 0);
  assert.equal(RUN_TRIGGER_LABELS.backfill, "기존 문서 한 번 실행");
  const screen = readFileSync(
    new URL("./sections/Synonyms.jsx", import.meta.url),
    "utf8"
  );
  for (const text of [
    "자동 생성 결과",
    "실패한 문서",
    "검증용",
    "문서명",
    "statusText",
  ])
    assert.ok(screen.includes(text), text);
});
