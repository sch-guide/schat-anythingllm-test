import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup: render } = require("react-dom/server");
function load(file, deps = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    transformSync(readFileSync(new URL(file, import.meta.url), "utf8"), {
      format: "cjs",
      loader: "jsx",
      jsx: "automatic",
    }).code,
    {
      module,
      exports: module.exports,
      Date,
      Number,
      console,
      require: (name) => (name in deps ? deps[name] : require(name)),
      ...deps.globals,
    }
  );
  return module.exports;
}
const ui = load("./ui.jsx");
const format = () => load("./aiFeesPresentation.js");
const budget = {
  revision: 2,
  records: [{ id: "one", date: "2026-10-10", amountKrw: 8000 }],
  totalChargedKrw: 8000,
  estimatedKrw: 2300,
  remainingKrw: 5700,
  percent: 28.75,
  level: "normal",
  questionsRemaining: 51.49,
  daysRemaining: 30.04,
};
test("rounding remains approximate, small positive money is never called zero, and sparse forecasts stay unknown", () => {
  const { money, questions, days } = format();
  assert.equal(money(2301), "약 2,300원");
  assert.equal(money(1), "약 100원 미만");
  assert.equal(money(null), "계산 불가");
  assert.equal(questions(null), "아직 계산 중이에요");
  assert.equal(questions(51.49), "약 50번");
  assert.equal(days(30.04), "약 30일");
});
function panel(deps = {}) {
  return load("./GeminiBudgetPanel.jsx", {
    "./ui": ui,
    "./aiFeesPresentation": format(),
    "@/utils/constants": { API_BASE: "/api" },
    "@/utils/request": { baseHeaders: () => ({}) },
    "./GeminiAvailabilityBanner": {
      BUDGET_NOTICE: "기록된 채팅 추정치",
      useGeminiAvailability: () => ({ data: { budget }, reload() {} }),
    },
    ...deps,
  });
}
test("summary uses three readable cards and never renders fake balance or progress for incomplete data", () => {
  const { GeminiBudgetSummary: Summary } = panel();
  const html = render(React.createElement(Summary, { budget }));
  assert.match(html, /충전 8,000원 중 약 2,300원 썼어요/);
  assert.match(html, /남은 돈/);
  assert.match(html, /더 할 수 있는 질문/);
  assert.match(html, /지금 속도라면/);
  assert.match(html, /role="progressbar"/);
  const missing = render(
    React.createElement(Summary, {
      budget: {
        ...budget,
        estimatedKrw: null,
        remainingKrw: null,
        percent: null,
        reason: "과거 기록",
      },
    })
  );
  assert.match(missing, /계산 불가/);
  assert.doesNotMatch(missing, /progressbar|100%|약 0원/);
});
test("recharge form retains input on server error and cancelled deletion sends nothing", async () => {
  let slot = 0;
  const state = [];
  const requests = [];
  const component = panel({
    react: {
      ...React,
      useEffect() {},
      useState: (initial) => {
        const i = slot++;
        if (!(i in state))
          state[i] = typeof initial === "function" ? initial() : initial;
        return [
          state[i],
          (v) => (state[i] = typeof v === "function" ? v(state[i]) : v),
        ];
      },
    },
    globals: {
      fetch: async (url, options) => {
        requests.push({ url, options });
        return { ok: false, json: async () => ({ error: "저장 실패" }) };
      },
      window: { confirm: () => false },
    },
  });
  const draw = () => {
    slot = 0;
    return component.default();
  };
  const all = (node) =>
    !React.isValidElement(node)
      ? []
      : [node, ...React.Children.toArray(node.props.children).flatMap(all)];
  let tree = draw();
  all(tree)
    .find((n) => n.props.id === "ai-recharge-amount")
    .props.onChange({ target: { value: "9000" } });
  tree = draw();
  await all(tree)
    .find((n) => n.type === "form")
    .props.onSubmit({ preventDefault() {} });
  tree = draw();
  assert.equal(
    all(tree).find((n) => n.props.id === "ai-recharge-amount").props.value,
    "9000"
  );
  assert.match(render(tree), /저장 실패/);
  const before = requests.length;
  await all(tree)
    .find((n) => n.props.children === "지우기")
    .props.onClick();
  assert.equal(requests.length, before);
  assert.equal(JSON.parse(requests[0].options.body).revision, 2);
});
