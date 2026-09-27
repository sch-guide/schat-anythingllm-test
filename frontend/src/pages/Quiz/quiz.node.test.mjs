import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("the staff quiz only reads stored questions and never generates", () => {
  const page = src("./index.jsx");
  assert.doesNotMatch(page, /generate|regenerate/i);
  assert.doesNotMatch(page, /Gemini|API/);
  assert.match(page, /지침서 기반 퀴즈/);
  assert.match(
    page,
    /병원 지침서를 바탕으로 만든 문제로 실무 지식을 확인해보세요\./
  );
  for (const label of [
    "대상 문서",
    "주제",
    "문항 수",
    "난이도",
    "문제 유형",
    "퀴즈 시작",
  ])
    assert.match(page, new RegExp(label));
  for (const label of [
    "문제 풀이 중",
    "이전",
    "정답 확인",
    "다음",
    "해설 및 근거",
  ])
    assert.match(page, new RegExp(label));
  // 근거 원문 보기 reuses the existing Citation row (PC PDF + mobile screen)
  assert.match(
    page,
    /import \{ SourceEvidenceRow \} from "@\/components\/WorkspaceChat\/ChatContainer\/ChatHistory\/Citation"/
  );
  assert.match(page, /현재 \$\{available\}문항이 준비되어 있습니다/);
  // mobile: one column, desktop: question + side card
  assert.match(page, /md:grid-cols-\[minmax\(0,1fr\)_300px\]/);

  const model = src("../../models/schatQuiz.js");
  const staff = model.slice(0, model.indexOf("// ---- admin"));
  assert.doesNotMatch(staff, /generate/);
  assert.match(
    model,
    /generate: \(input\) =>\s*call\("\/schat-admin\/quiz\/generate"/
  );
});

test("staff menu, route and admin menu", () => {
  const link = src("../../components/SchatQuiz/QuizLink.jsx");
  assert.match(link, /지침서 퀴즈/);
  const icon = src("../../components/SchatQuiz/QuizIcon.jsx");
  assert.match(icon, /stroke="currentColor"/);
  const main = src("../../main.jsx");
  assert.match(
    main,
    /path: "\/quiz"[\s\S]*PrivateRoute Component=\{QuizPage\}/
  );
  const menu = src("../SchatAdmin/menu.js");
  assert.match(menu, /key: "quiz",\s*label: "퀴즈 관리"/);
});

test("admin quiz: AI only in 문제 생성 / 다시 생성, review before 공개", () => {
  const section = src("../SchatAdmin/sections/Quiz.jsx");
  for (const tab of ["문제 목록", "퀴즈 세트", "문제 생성", "통계"])
    assert.match(section, new RegExp(`"${tab}"`));
  assert.match(
    section,
    /AI는 문제를 생성할 때만 사용됩니다\. 직원이 퀴즈를 푸는 동안에는 AI\s+API를\s+사용하지 않습니다\./
  );
  assert.match(
    section,
    /오늘 AI 문제 생성: \{usage\?\.today\?\.requests \?\? "-"\}회/
  );
  assert.match(section, /AI로 문제 만들기/);
  // generation is the only AI call in the list screen
  assert.equal(
    (section.match(/SchatQuiz\.(generate|regenerate)\(/g) || []).length,
    1
  );
  const review = src("../SchatAdmin/sections/QuizReview.jsx");
  assert.equal(
    (review.match(/SchatQuiz\.(generate|regenerate)\(/g) || []).length,
    1
  );
  assert.match(review, /원문 확인/);
  assert.match(review, /SourceEvidenceRow/);
  // 공개 is disabled while edits are unsaved and for old-document questions
  assert.match(review, /disabled=\{dirty \|\| !!busy \|\| q\.outdated\}/);
  assert.match(review, /완전삭제/);
});

test("every admin section has a menu icon", async () => {
  const { SCHAT_ADMIN_SECTIONS } = await import("../SchatAdmin/menu.js");
  const sidebar = src("../../components/SettingsSidebar/index.jsx");
  const icons = sidebar.slice(sidebar.indexOf("const SECTION_ICONS"));
  for (const { key } of SCHAT_ADMIN_SECTIONS)
    assert.match(icons, new RegExp(`\\n  ${key}: \\w+,`), key);
});

test("score, result, own history and wrong-answer notes (no AI)", () => {
  const page = src("./index.jsx");
  for (const label of [
    "현재 점수",
    "정답률",
    "퀴즈 완료",
    "틀린 문제 다시 보기",
    "다시 풀기",
    "종료",
    "오답노트",
    "최근 기록",
    "내가 선택한 답",
    "내 기록만 표시됩니다.",
  ])
    assert.match(page, new RegExp(label));
  // 현재 점수 is computed in the browser from the answers so far
  assert.match(page, /Math\.round\(\(correct \/ answered\) \* 100\)/);
  // wrong review and history use the stored-data endpoints only
  assert.match(page, /SchatQuiz\.startWrongReview\(/);
  assert.match(page, /SchatQuiz\.history\(\)/);
  assert.match(page, /SchatQuiz\.wrongNotes\(\)/);
  const model = src("../../models/schatQuiz.js");
  assert.match(model, /history: \(\) => call\("\/schat\/quiz\/history"\)/);
});

test("admin statistics are aggregates without individual results", () => {
  const stats = src("../SchatAdmin/sections/QuizStats.jsx");
  for (const label of [
    "자주 틀리는 문항",
    "문항별 정답률",
    "부서별 통계",
    "주제별 정답률",
  ])
    assert.match(stats, new RegExp(label));
  assert.match(
    stats,
    /응답자 \{stats\.minRespondents\}명 미만 · 표시하지 않음/
  );
  assert.match(stats, /직원 개인별 점수나 순위는/);
  // no per-person fields are rendered
  assert.doesNotMatch(stats, /userId|username|employeeNumber|displayName/i);
  const list = src("../SchatAdmin/sections/Quiz.jsx");
  assert.match(list, /이전 문서 기반/);
});
