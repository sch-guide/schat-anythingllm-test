import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const React = require("react");
const { transformSync } = require("esbuild");
function load(file, deps, globals = {}) {
  const module = { exports: {} };
  const { code } = transformSync(
    readFileSync(new URL(file, import.meta.url), "utf8"),
    { loader: "jsx", format: "cjs", jsx: "automatic" }
  );
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => (name in deps ? deps[name] : require(name)),
    ...globals,
  });
  return module.exports;
}
const ui = load("./ui.jsx", {});
const labels = load("./sections/quizLabels.js", {});
const nodes = (tree) =>
  !React.isValidElement(tree)
    ? []
    : [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)];
function harness() {
  const slots = [],
    effects = [],
    timers = [];
  let cursor = 0;
  return {
    hooks: {
      ...React,
      useState(initial) {
        const i = cursor++;
        if (!(i in slots))
          slots[i] = typeof initial === "function" ? initial() : initial;
        return [
          slots[i],
          (v) => {
            slots[i] = typeof v === "function" ? v(slots[i]) : v;
          },
        ];
      },
      useRef(initial) {
        const i = cursor++;
        return (slots[i] ||= { current: initial });
      },
      useCallback(fn) {
        return fn;
      },
      useEffect(fn) {
        effects.push(fn);
      },
    },
    globals: {
      setTimeout(fn) {
        timers.push(fn);
        return timers.length;
      },
      clearTimeout() {},
    },
    draw(Component, props) {
      cursor = 0;
      return Component(props);
    },
    async flush() {
      const current = effects.splice(0);
      for (const fn of current) fn();
      for (const fn of timers.splice(0)) await fn();
      await Promise.resolve();
    },
  };
}

test("현재/이전 문서 필터와 각 행 삭제 및 이전 문서 전체 삭제가 같은 목록 대상을 쓴다", async () => {
  const h = harness();
  const requests = [];
  const rows = [1, 2, 3].map((id) => ({
    id,
    question: `가상 ${id}`,
    documentName: "이전.pdf",
    outdated: true,
    status: "draft",
    statusLabel: "작성중",
  }));
  const Dialog = () => null;
  const { QuestionList } = load(
    "./sections/Quiz.jsx",
    {
      react: h.hooks,
      "../ui": ui,
      "./quizLabels": labels,
      "@/utils/toast": () => {},
      "./QuizReview": () => null,
      "./QuizStats": () => null,
      "./QuizDelete": Dialog,
      "@/models/schatQuiz": {
        questions: async (filters) => {
          requests.push({ ...filters });
          return { success: true, questions: rows };
        },
        documents: async () => ({ documents: [] }),
      },
    },
    h.globals
  );
  assert.equal(typeof QuestionList, "function");
  let tree = h.draw(QuestionList, {});
  await h.flush();
  tree = h.draw(QuestionList, {});
  const filter = nodes(tree).find(
    (n) => n.props["aria-label"] === "문서 사용 필터"
  );
  assert.ok(filter);
  assert.equal(filter.props.role, "group");
  assert.deepEqual(
    React.Children.toArray(filter.props.children).map((n) => n.props.children),
    ["전체", "사용 중", "이전 문서"]
  );
  React.Children.toArray(filter.props.children)
    .find((n) => n.props.children === "이전 문서")
    .props.onClick();
  tree = h.draw(QuestionList, {});
  await h.flush();
  tree = h.draw(QuestionList, {});
  assert.equal(requests.at(-1).documentState, "outdated");
  assert.equal(
    nodes(tree).filter(
      (n) =>
        n.type === ui.Badge &&
        n.props.tone === "neutral" &&
        n.props.children === "이전 문서 · 직원 풀이 불가"
    ).length,
    3
  );
  const remove = nodes(tree).find(
    (n) => n.props["aria-label"] === "1번 문제 삭제"
  );
  assert.ok(remove);
  remove.props.onClick();
  tree = h.draw(QuestionList, {});
  assert.deepEqual(
    Array.from(nodes(tree).find((n) => n.type === Dialog).props.target.ids),
    [1]
  );
  const all = nodes(tree).find(
    (n) => n.props["data-testid"] === "quiz-delete-previous"
  );
  all.props.onClick();
  tree = h.draw(QuestionList, {});
  const target = nodes(tree).find((n) => n.type === Dialog).props.target;
  assert.deepEqual(Array.from(target.ids), [1, 2, 3]);
  assert.equal(target.filters.documentState, "outdated");
});

test("확인창은 기록 보존을 설명하고 정확한 삭제 입력과 중복 클릭 방지를 적용한다", async () => {
  const h = harness();
  const requests = [];
  let release;
  let closed = 0;
  let changed = 0;
  const { default: Dialog } = load("./sections/QuizDelete.jsx", {
    react: h.hooks,
    "../ui": ui,
    "@/utils/toast": () => {},
    "@/components/lib/Modal": {
      __esModule: true,
      default: () => null,
      ModalBody: () => null,
      ModalHeader: () => null,
    },
    "@/models/schatQuiz": {
      deleteQuestions: async (...args) => {
        requests.push(args);
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  const target = {
    ids: [2, 3],
    filters: { documentState: "outdated", status: "draft" },
  };
  const props = {
    target,
    onClose: () => {
      closed++;
    },
    onChanged: () => {
      changed++;
    },
  };
  let tree = h.draw(Dialog, props);
  assert.ok(
    nodes(tree).some(
      (n) =>
        n.type === "p" &&
        React.Children.toArray(n.props.children).join("") ===
          "2개 퀴즈를 지울까요? 직원 풀이 기록은 남아요."
    )
  );
  const input = () =>
    nodes(tree).find((n) => n.props["aria-label"] === "삭제 확인 입력");
  const button = () =>
    nodes(tree).find(
      (n) => n.type === ui.Button && n.props.variant === "danger"
    );
  assert.equal(button().props.disabled, true);
  input().props.onChange({ target: { value: " 삭제" } });
  tree = h.draw(Dialog, props);
  assert.equal(button().props.disabled, true);
  input().props.onChange({ target: { value: "삭제" } });
  tree = h.draw(Dialog, props);
  assert.equal(button().props.disabled, false);
  const pending = button().props.onClick();
  await button().props.onClick();
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), [
    [2, 3],
    "삭제",
    { documentState: "outdated", status: "draft" },
  ]);
  tree = h.draw(Dialog, props);
  assert.equal(button().props.disabled, true);
  release({ success: false, error: "삭제 대상이 바뀌었습니다." });
  await pending;
  tree = h.draw(Dialog, props);
  assert.ok(
    nodes(tree).some(
      (n) =>
        n.props.role === "alert" &&
        n.props.children === "삭제 대상이 바뀌었습니다."
    )
  );
  assert.equal(closed, 0);
  assert.equal(changed, 1);
});

test("삭제 요청에는 행의 번호와 전체 삭제의 최신 대상 확인 필터를 그대로 보낸다", async () => {
  const requests = [];
  const { default: model } = load(
    "../../models/schatQuiz.js",
    {
      "@/utils/constants": { API_BASE: "/synthetic" },
      "@/utils/request": { baseHeaders: () => ({}) },
    },
    {
      URLSearchParams,
      fetch: async (url, init) => {
        requests.push({ url, ...JSON.parse(init.body) });
        return { ok: true, json: async () => ({ success: true, count: 1 }) };
      },
    }
  );
  await model.deleteQuestions([2], "삭제");
  await model.deleteQuestions([2, 3], "삭제", {
    documentState: "outdated",
    status: "draft",
  });
  assert.deepEqual(requests, [
    {
      url: "/synthetic/schat-admin/quiz/questions/delete",
      ids: [2],
      confirm: "삭제",
    },
    {
      url: "/synthetic/schat-admin/quiz/questions/delete",
      ids: [2, 3],
      confirm: "삭제",
      filters: { documentState: "outdated", status: "draft" },
    },
  ]);
});
