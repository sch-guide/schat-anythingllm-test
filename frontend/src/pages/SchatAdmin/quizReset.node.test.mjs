import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const React = require("react");
const { transformSync } = require("esbuild");
function load(file, deps) {
  const module = { exports: {} };
  const { code } = transformSync(readFileSync(new URL(file, import.meta.url), "utf8"), {
    loader: "jsx", format: "cjs", jsx: "automatic",
  });
  vm.runInNewContext(code, { module, exports: module.exports, console,
    require: (name) => name in deps ? deps[name] : require(name) });
  return module.exports;
}
const nodes = (tree) => !React.isValidElement(tree) ? [] : [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)];
function harness() {
  const slots = [], effects = [], dependencies = [];
  let cursor = 0;
  return {
    hooks: { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
        return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
      useEffect(fn, deps) { const i = cursor++; if (!dependencies[i] || deps.some((v, n) => v !== dependencies[i][n])) {
        dependencies[i] = deps; effects.push(fn); } },
    },
    draw(Component, props = {}) { cursor = 0; return Component(props); },
    async flush() { for (const fn of effects.splice(0)) fn(); await new Promise((r) => setImmediate(r)); },
  };
}
const ui = load("./ui.jsx", {});
const modal = { __esModule: true, default: (props) => props.children, ModalBody: (props) => props.children, ModalHeader: () => null };

test("관리자 확인은 정확한 입력과 최신 확인 토큰을 전송한다", async () => {
  assert.ok(existsSync(new URL("./sections/QuizReset.jsx", import.meta.url)), "초기화 확인 화면이 필요합니다");
  const h = harness(), calls = [];
  let done = 0, closed = 0;
  const api = { resetPreview: async () => ({ success: true, token: "first", staffCount: 3, attemptCount: 8 }),
    resetRecords: async (confirm, token) => { calls.push([confirm, token]); return { success: true, lastResetAt: "2026-10-12" }; } };
  const { QuizResetDialog } = load("./sections/QuizReset.jsx", { react: h.hooks, "../ui": ui,
    "@/components/lib/Modal": modal, "@/models/schatQuiz": api, "@/utils/toast": () => {} });
  const props = { onClose: () => closed++, onReset: () => done++ };
  let tree = h.draw(QuizResetDialog, props); await h.flush(); tree = h.draw(QuizResetDialog, props);
  const find = (id) => nodes(tree).find((n) => n.props["data-testid"] === id);
  assert.equal(find("quiz-reset-execute").props.disabled, true);
  let input = nodes(tree).find((n) => n.props["aria-label"] === "초기화 확인 입력");
  input.props.onChange({ target: { value: " 초기화" } }); tree = h.draw(QuizResetDialog, props);
  assert.equal(find("quiz-reset-execute").props.disabled, true);
  input.props.onChange({ target: { value: "초기화" } }); tree = h.draw(QuizResetDialog, props);
  assert.equal(find("quiz-reset-execute").props.disabled, false);
  await find("quiz-reset-execute").props.onClick();
  assert.deepEqual(calls, [["초기화", "first"]]); assert.equal(done, 1); assert.equal(closed, 1);
});

test("직원 첫 화면 안내를 표시한 뒤 자동 읽음 저장하고 실패하면 재시도할 수 있다", async () => {
  assert.ok(existsSync(new URL("../Quiz/ResetNotice.jsx", import.meta.url)), "직원 안내 화면이 필요합니다");
  const h = harness(); let calls = 0;
  const { default: Notice } = load("../Quiz/ResetNotice.jsx", { react: h.hooks,
    "@/models/schatQuiz": { resetNotice: async () => ({ success: true, notice: { generation: 2, lastResetAt: "2026-10-12" } }),
      acknowledgeReset: async (generation) => { assert.equal(generation, 2); calls++; return { success: calls > 1 }; } } });
  h.draw(Notice); await h.flush(); let tree = h.draw(Notice); await h.flush(); tree = h.draw(Notice);
  assert.ok(nodes(tree).find((n) => n.props["data-testid"] === "quiz-reset-notice"));
  const notice = nodes(tree).find((n) => n.props["data-testid"] === "quiz-reset-notice");
  assert.equal(React.Children.toArray(notice.props.children).filter((v) => typeof v === "string").join(""), "퀴즈 기록이 새로 시작됐어요");
  assert.equal(calls, 1);
  const retry = nodes(tree).find((n) => n.props["data-testid"] === "quiz-reset-notice-ack");
  await retry.props.onClick(); tree = h.draw(Notice);
  assert.equal(calls, 2);
  assert.equal(nodes(tree).some((n) => n.props["data-testid"] === "quiz-reset-notice-ack"), false);
});

test("초기화 실패 뒤에는 새 대상을 불러오고 재입력을 요구하며 연속 클릭은 한 번만 전송한다", async () => {
  const h = harness(); let previews = 0, writes = 0, release;
  const wait = new Promise((r) => { release = r; });
  const { QuizResetDialog } = load("./sections/QuizReset.jsx", { react: h.hooks, "../ui": ui,
    "@/components/lib/Modal": modal, "@/utils/toast": () => {},
    "@/models/schatQuiz": {
      resetPreview: async () => ({ success: true, token: `token-${++previews}`, staffCount: 1, attemptCount: 1 }),
      resetRecords: async () => { writes++; await wait; return { success: false, error: "대상이 바뀌었습니다" }; },
    } });
  let closes = 0;
  const props = { onClose: () => closes++ };
  h.draw(QuizResetDialog, props); await h.flush(); let tree = h.draw(QuizResetDialog, props);
  nodes(tree).find((n) => n.props["data-testid"] === "quiz-reset-cancel").props.onClick();
  assert.equal(closes, 1); assert.equal(writes, 0);
  nodes(tree).find((n) => n.props["aria-label"] === "초기화 확인 입력").props.onChange({ target: { value: "초기화" } });
  tree = h.draw(QuizResetDialog, props);
  const click = nodes(tree).find((n) => n.props["data-testid"] === "quiz-reset-execute").props.onClick;
  const first = click(); await click(); assert.equal(writes, 1); release(); await first;
  tree = h.draw(QuizResetDialog, props);
  assert.equal(previews, 2);
  assert.equal(nodes(tree).find((n) => n.props["aria-label"] === "초기화 확인 입력").props.value, "");
  assert.equal(nodes(tree).find((n) => n.props["data-testid"] === "quiz-reset-execute").props.disabled, true);
  assert.ok(nodes(tree).find((n) => n.props.role === "alert"));
});

test("날짜 조회 실패를 표시하고 확인창에서 조회에 성공하면 바깥 날짜도 갱신한다", async () => {
  const h = harness();
  const deps = { react: h.hooks, "../ui": ui, "@/components/lib/Modal": modal,
    "@/utils/toast": () => {}, "@/models/schatQuiz": { resetPreview: async () => ({ success: false }) } };
  const { default: Reset } = load("./sections/QuizReset.jsx", deps);
  h.draw(Reset, {}); await h.flush(); let tree = h.draw(Reset, {});
  let date = nodes(tree).find((n) => n.props["data-testid"] === "quiz-reset-last-date");
  assert.match(React.Children.toArray(date.props.children).join(""), /확인하지 못했어요/);
  nodes(tree).find((n) => n.props["data-testid"] === "quiz-reset-open").props.onClick();
  tree = h.draw(Reset, {});
  const dialogProps = nodes(tree).find((n) => n.type.name === "QuizResetDialog").props;
  const d = harness();
  const { QuizResetDialog } = load("./sections/QuizReset.jsx", { ...deps, react: d.hooks,
    "@/models/schatQuiz": { resetPreview: async () => ({ success: true, token: "fresh", lastResetAt: "2026-10-12T09:00:00Z" }) } });
  d.draw(QuizResetDialog, dialogProps); await d.flush(); tree = h.draw(Reset, {});
  date = nodes(tree).find((n) => n.props["data-testid"] === "quiz-reset-last-date");
  const text = React.Children.toArray(date.props.children).join("");
  assert.doesNotMatch(text, /확인하지 못했어요|확인 중/);
  assert.match(text, /2026/);
});
