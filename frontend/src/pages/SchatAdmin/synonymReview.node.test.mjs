import test from "node:test";
import assert from "node:assert/strict";
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
});

test("직원 질문 후보는 표현·관련 묶음·발견 경로·가린 예시·시각·확신도를 정리", async () => {
  const review = await import("./synonymReview.js");
  const detail = review.candidateDetail(
    {
      id: 3,
      type: "addition",
      terms: ["씨라인"],
      method: "gemini-staff-questions-v1",
      confidence: 0.86,
      createdAt: "2026-10-13T01:05:00Z",
      sources: [
        {
          type: "staff_questions",
          count: 3,
          example: "[이름] 씨라인 드레싱 주기",
        },
      ],
    },
    { terms: ["중심정맥관", "C-line"] }
  );
  assert.equal(detail.expression, "씨라인");
  assert.equal(detail.related, "중심정맥관, C-line");
  assert.deepEqual(detail.origins, ["직원 질문", "AI 자동 제안"]);
  assert.deepEqual(detail.staff, [
    { count: 3, example: "[이름] 씨라인 드레싱 주기" },
  ]);
  assert.equal(detail.confidence, "확신도 86%");
  assert.match(detail.created, /^2026-10-13/);
});

test("저장 확인 필요는 뜻과 확인할 것을 보여주고 다른 상태는 숨김", async () => {
  const review = await import("./synonymReview.js");
  assert.equal(review.runProblem({ status: "done" }), null);
  const problem = review.runProblem({
    status: "persistence_failed",
    summary: { failureStep: "final_record" },
  });
  assert.match(problem.what, /마지막 결과를 기록하지 못했어요/);
  assert.ok(problem.check.some((line) => /검토 대기/.test(line)));
  assert.match(
    review.runProblem({ status: "persistence_failed" }).what,
    /실제와 다를 수 있어요/
  );
  assert.equal(review.RUN_STATUS_TEXT.failed, "실패");
  assert.equal(review.RUN_TRIGGER_LABELS.staff_questions, "직원 질문");
});
