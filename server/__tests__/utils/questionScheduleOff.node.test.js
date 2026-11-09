// 2026-11-09 사용자 결정: 직원 질문 후보(매일 새벽 3시)는 기본으로 끈다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("직원 질문 후보 예약은 SCHAT_QUESTION_SYNONYMS_ENABLED=true일 때만 건다", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../utils/BackgroundWorkers/index.js"),
    "utf8"
  );
  assert.match(
    source,
    /if \(process\.env\.SCHAT_QUESTION_SYNONYMS_ENABLED === "true"\)\s*this\.#questionCandidateTimer = require\("\.\.\/synonyms\/questionCandidateService"\)\s*\.installQuestionSchedule\(later\);/
  );
});
