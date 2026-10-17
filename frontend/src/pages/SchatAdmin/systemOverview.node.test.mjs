import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function load(relative, deps = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    transformSync(readFileSync(new URL(relative, import.meta.url), "utf8"), {
      format: "cjs",
      loader: "jsx",
      jsx: "automatic",
    }).code,
    {
      module,
      exports: module.exports,
      require: (name) => (name in deps ? deps[name] : require(name)),
    }
  );
  return module.exports;
}
function overview() {
  return load("./SystemOverview.jsx", { "./ui": load("./ui.jsx") });
}
test("unknown AI, missing daily counts and untested connections never look healthy", () => {
  const { SystemLights } = overview();
  const html = renderToStaticMarkup(
    React.createElement(SystemLights, {
      connections: { llm: { keySet: true }, embedding: { keySet: true } },
    })
  );
  assert.match(html, /AI 상태/);
  assert.match(html, /오늘 사용량/);
  assert.match(html, /연결 상태/);
  assert.doesNotMatch(html, /정상|0%/);
  assert.match(html, /미확인/);
});
test("exhaustion, daily warning and a failed connection remain separate", () => {
  const { SystemLights } = overview();
  const html = renderToStaticMarkup(
    React.createElement(SystemLights, {
      ai: { status: "exhausted" },
      daily: { available: true, count: 7200 },
      connectionResult: { ok: false },
      connections: { llm: { keySet: true }, embedding: { keySet: true } },
    })
  );
  assert.match(html, /한도 소진/);
  assert.match(html, /72%/);
  assert.match(html, /연결 확인 필요/);
});
test("known normal and successful connection are distinguished from budget estimates", () => {
  const { SystemLights } = overview();
  const html = renderToStaticMarkup(
    React.createElement(SystemLights, {
      ai: { status: "normal" },
      daily: { available: true, count: 50 },
      connectionResult: { ok: true },
    })
  );
  assert.match(html, /정상/);
  assert.match(html, /0.5%/);
  assert.match(html, /연결 확인됨/);
});
test("money warning is an independent fourth light and never replaces actual quota or connection", () => {
  const { SystemLights } = overview();
  const html = renderToStaticMarkup(
    React.createElement(SystemLights, {
      ai: { status: "exhausted" },
      daily: { available: true, count: 50 },
      connectionResult: { ok: true },
      budget: { level: "warning", remainingKrw: 199 },
    })
  );
  assert.match(html, /AI 요금 충전 필요/);
  assert.match(html, /한도 소진/);
  assert.match(html, /연결 확인됨/);
  const missing = renderToStaticMarkup(
    React.createElement(SystemLights, {
      budget: { level: "unavailable", remainingKrw: null },
    })
  );
  assert.match(missing, /계산 불가/);
});
test("status keeps details closed and tests both connections only on button action", async () => {
  let slot = 0;
  const calls = [];
  const values = [
    {
      workspaces: [],
      checklists: { total: 3, active: 1, review: 2 },
      connections: {},
    },
    null,
    false,
    false,
    null,
  ];
  const view = load("./sections/Status.jsx", {
    react: {
      useState: (initial) => {
        const index = slot++;
        if (!(index in values)) values[index] = initial;
        return [values[index], (v) => (values[index] = v)];
      },
      useEffect() {},
      useRef: () => revision,
    },
    "@/models/system": { __esModule: true, default: {} },
    "@/models/schatAdmin": {
      __esModule: true,
      default: {
        status: async () => ({
          workspaces: [],
          connections: { llm: { keySet: true } },
        }),
        connectionTest: async (target) => {
          calls.push(target);
          return { ok: target === "llm" };
        },
      },
    },
    "../ui": load("./ui.jsx"),
    "../GeminiBudgetPanel": { __esModule: true, default: "budget-panel" },
    "../GeminiCostCard": { __esModule: true, default: "gemini-cost-card" },
    "../CurrentUsageCard": { __esModule: true, SearchDataRow: "search-data-row" },
    "./Connections": { __esModule: true, default: "connection-settings" },
    "../ChatAdmissionPanel": { __esModule: true, default: "admission-panel" },
    "../GeminiAvailabilityBanner": {
      useGeminiAvailability: () => ({ data: { state: { status: "normal" } } }),
    },
    "../SystemOverview": overview(),
    "react-router-dom": {
      Link: ({ to, children, ...props }) =>
        React.createElement("a", { href: to, ...props }, children),
    },
  });
  const revision = { current: 0 };
  const draw = () => {
    slot = 0;
    return view.default();
  };
  function all(node) {
    return !React.isValidElement(node)
      ? []
      : [node, ...React.Children.toArray(node.props.children).flatMap(all)];
  }
  let tree = draw();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /검토 필요 2/);
  assert.match(html, /검토하러 가기/);
  assert.doesNotMatch(
    html,
    /budget-panel|connection-settings|<details[^>]*open/
  );
  assert.deepEqual(calls, []);
  await all(tree)
    .find((node) => node.props.children === "연결 시험")
    .props.onClick();
  assert.deepEqual(calls, ["llm", "embedding"]);
  assert.equal(values[4].ok, false);
  all(tree)
    .find((node) => node.type === "details")
    .props.onToggle({ currentTarget: { open: true } });
  tree = draw();
  assert.ok(all(tree).some((node) => node.type === "budget-panel"));
  assert.ok(all(tree).some((node) => node.type === "connection-settings"));
  values[4] = { ok: true };
  await all(tree)
    .find((node) => node.type === "connection-settings")
    .props.onSaved();
  assert.equal(
    values[4],
    null,
    "changed connection must invalidate a previous green result"
  );
  assert.equal(values[0].connections.llm.keySet, true);
});

test("시스템 상태는 용도별 AI 모델을 읽기 전용으로 보여 주고 열쇠는 표시하지 않음", () => {
  const status = readFileSync(new URL("./sections/Status.jsx", import.meta.url), "utf8");
  assert.match(status, /<ModelPurposes models=\{models\} \/>/);
  assert.match(status, /용도별 AI 모델/);
  assert.match(status, /답변 모델과 같음/);
  assert.doesNotMatch(status.slice(status.indexOf("function ModelPurposes")), /apiKey|열쇠 입력/);
});
