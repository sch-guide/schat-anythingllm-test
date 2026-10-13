import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url),
  React = require("react");
const { renderToStaticMarkup } = require("react-dom/server"),
  { transformSync } = require("esbuild");
function load(file, deps = {}) {
  const module = { exports: {} };
  const { code } = transformSync(
    readFileSync(new URL(file, import.meta.url), "utf8"),
    {
      loader: "jsx",
      format: "cjs",
      jsx: "automatic",
    }
  );
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => (name in deps ? deps[name] : require(name)),
  });
  return module.exports;
}
const ui = load("./ui.jsx");
const card = load("./GeminiCostCard.jsx", {
  "./ui": ui,
  "./aiFeesPresentation": load("./aiFeesPresentation.js"),
  "./SystemOverview": load("./SystemOverview.jsx", { "./ui": ui }),
});
const render = (props) =>
  renderToStaticMarkup(React.createElement(card.default, props));

test("기록된 사용량 기준 예상 비용으로 표시하고 '현재 잔액'이라 부르지 않음", () => {
  const html = render({
    ai: { status: "normal" },
    budget: {
      records: [{ amountKrw: 10000 }],
      totalChargedKrw: 10000,
      percent: 23.4,
      month: { estimatedKrw: 2301, chargedQuestions: 10, partial: false },
    },
  });
  for (const text of [
    "Gemini AI",
    "정상",
    "이번 달 예상 사용요금",
    "약 2,300원",
    "약 23%",
    "기록된 사용량 기준 예상 비용",
    "실제 Gemini 잔액과 다를 수 있습니다",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /현재 Gemini 잔액/);
});

test("일부 기록 제외와 단가 정보 없음 모델을 따로 알려줌", () => {
  const html = render({
    ai: { status: "normal" },
    budget: {
      month: {
        estimatedKrw: 1575,
        chargedQuestions: 3,
        partial: true,
        reason: "일부 기록 제외 2건: 단가 정보 없음 1건",
        unknownModels: ["gemini-3.1-flash"],
      },
    },
  });
  assert.match(html, /약 1,600원/);
  assert.match(html, /일부 기록 제외 2건/);
  assert.match(html, /단가 정보 없음: gemini-3\.1-flash/);
  assert.match(html, /충전 기록을 추가하면 표시돼요/);
});

test("계산 가능한 기록이 없으면 이유별로 표시", () => {
  assert.equal(
    card.costText({
      estimatedKrw: null,
      unknownModels: ["gemini-3.1-flash"],
      chargedQuestions: 2,
    }),
    "단가 정보 없음"
  );
  assert.equal(
    card.costText({
      estimatedKrw: null,
      unknownModels: [],
      chargedQuestions: 0,
    }),
    "아직 기록 없음"
  );
  assert.equal(
    card.costText({
      estimatedKrw: null,
      unknownModels: [],
      chargedQuestions: 4,
    }),
    "계산 불가"
  );
});

test("사용 통계에는 예상 요금 대신 위치 안내만 남음", () => {
  const usage = readFileSync(
    new URL("./sections/UsageStats.jsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(usage, /예상 AI 요금"/);
  assert.doesNotMatch(usage, /estimatedCost/);
  assert.match(usage, /시스템 상태의 Gemini AI 칸/);
  const status = readFileSync(
    new URL("./sections/Status.jsx", import.meta.url),
    "utf8"
  );
  assert.match(status, /<GeminiCostCard /);
});

test("질문창 아래에 SCHAT이 실수할 수 있다는 안내가 항상 보임", () => {
  const input = readFileSync(
    new URL(
      "../../components/WorkspaceChat/ChatContainer/PromptInput/index.jsx",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(input, /data-testid="schat-mistake-notice"/);
  assert.match(
    input,
    /SCHAT은 실수할 수 있습니다\. 중요한 내용은 원문 지침을 꼭\s+확인하세요\./
  );
});
