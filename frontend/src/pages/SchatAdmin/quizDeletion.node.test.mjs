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
      "./QuizSetDelete": () => null,
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

test("확인창은 지울 문제·풀이 기록 수를 먼저 보여 주고 그 수로만 삭제하며 중복 클릭을 막는다", async () => {
  const h = harness();
  const requests = [];
  const previews = [];
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
      deletePreview: async (...args) => {
        previews.push(args);
        return { success: true, questions: 2, answers: 7, wrongNotes: 3 };
      },
      deleteQuestions: async (...args) => {
        requests.push(args);
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  const target = { ids: [2, 3], filters: { documentState: "outdated" } };
  const props = {
    target,
    onClose: () => closed++,
    onChanged: () => changed++,
  };
  let tree = h.draw(Dialog, props);
  const button = () =>
    nodes(tree).find((n) => n.props["data-testid"] === "quiz-delete-confirm");
  assert.equal(button().props.disabled, true);
  await h.flush();
  await Promise.resolve();
  tree = h.draw(Dialog, props);
  assert.equal(JSON.stringify(previews[0]), JSON.stringify([[2, 3], { documentState: "outdated" }]));
  const message = nodes(tree).find((n) => n.props["data-testid"] === "quiz-delete-message");
  assert.equal(
    React.Children.toArray(message.props.children).join(""),
    "문제 2개와 직원 풀이 기록 7건을 지워요. 되돌릴 수 없어요."
  );
  assert.equal(button().props.disabled, false);
  const pending = button().props.onClick();
  await button().props.onClick();
  assert.equal(requests.length, 1);
  assert.equal(
    JSON.stringify(requests[0]),
    JSON.stringify([[2, 3], { documentState: "outdated" }, { answers: 7, wrongNotes: 3 }])
  );
  release({ success: false, error: "지울 기록 수가 바뀌었습니다." });
  await pending;
  tree = h.draw(Dialog, props);
  assert.ok(
    nodes(tree).some(
      (n) => n.props.role === "alert" && n.props.children === "지울 기록 수가 바뀌었습니다."
    )
  );
  assert.equal(closed, 0);
  assert.equal(changed, 1);
});

test("한 문제 삭제 문구는 '이 문제와 직원 풀이 기록 N건'이다", async () => {
  const h = harness();
  const { default: Dialog } = load("./sections/QuizDelete.jsx", {
    react: h.hooks,
    "../ui": ui,
    "@/utils/toast": () => {},
    "@/components/lib/Modal": { __esModule: true, default: () => null, ModalBody: () => null, ModalHeader: () => null },
    "@/models/schatQuiz": {
      deletePreview: async () => ({ success: true, questions: 1, answers: 4, wrongNotes: 0 }),
    },
  });
  const props = { target: { ids: [5] }, onClose() {} };
  h.draw(Dialog, props);
  await h.flush();
  await Promise.resolve();
  const tree = h.draw(Dialog, props);
  const message = nodes(tree).find((n) => n.props["data-testid"] === "quiz-delete-message");
  assert.equal(
    React.Children.toArray(message.props.children).join(""),
    "이 문제와 직원 풀이 기록 4건을 지워요. 되돌릴 수 없어요."
  );
});

test("확인용 수 조회와 삭제 요청에 같은 대상·필터·기록 수를 보낸다", async () => {
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
        return { ok: true, json: async () => ({ success: true }) };
      },
    }
  );
  await model.deletePreview([2]);
  await model.deleteQuestions([2], null, { answers: 1, wrongNotes: 0 });
  await model.deleteQuestions([2, 3], { documentState: "outdated" }, { answers: 0, wrongNotes: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    { url: "/synthetic/schat-admin/quiz/questions/delete-preview", ids: [2] },
    { url: "/synthetic/schat-admin/quiz/questions/delete", ids: [2], confirm: "삭제", expected: { answers: 1, wrongNotes: 0 } },
    {
      url: "/synthetic/schat-admin/quiz/questions/delete",
      ids: [2, 3],
      confirm: "삭제",
      expected: { answers: 0, wrongNotes: 0 },
      filters: { documentState: "outdated" },
    },
  ]);
});

test("초기화·되살리기·이전 지침 배지는 화면에 남아 있지 않다", () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
  const admin = read("./sections/Quiz.jsx");
  assert.doesNotMatch(admin, /QuizReset|삭제한 퀴즈|되살리기|restore/);
  assert.doesNotMatch(read("./sections/QuizDelete.jsx"), /되살릴|직원 풀이 기록은 남아/);
  assert.doesNotMatch(read("./sections/QuizReview.jsx"), /되살릴|기록과\s+오답노트는 남아/);
  assert.match(read("./sections/QuizStats.jsx"), /이전 문서 퀴즈의 풀이는 빼고 계산합니다/);
  const staff = read("../Quiz/index.jsx");
  assert.doesNotMatch(staff, /ResetNotice|이전 지침 기준|previousGuideline/);
  const model = read("../../models/schatQuiz.js");
  assert.doesNotMatch(model, /reset|restore/i);
});

test("세트 삭제 확인창: '정말 삭제할까요?'와 직원 수·기록 수를 보여 주고 그 수로만 지운다", async () => {
  const h = harness();
  const requests = [];
  let deleted = 0;
  const { default: Dialog } = load("./sections/QuizSetDelete.jsx", {
    react: h.hooks,
    "../ui": ui,
    "@/utils/toast": () => {},
    "@/components/lib/Modal": { __esModule: true, default: () => null, ModalBody: () => null, ModalHeader: () => null },
    "@/models/schatQuiz": {
      setDeletePreview: async () => ({ success: true, title: "가짜 세트", questions: 5, answers: 12, wrongNotes: 3, staff: 4 }),
      deleteSet: async (...args) => {
        requests.push(args);
        return { success: true };
      },
    },
  });
  const props = { set: { id: 7, title: "가짜 세트" }, onClose() {}, onDeleted: () => deleted++ };
  h.draw(Dialog, props);
  await h.flush();
  await Promise.resolve();
  const tree = h.draw(Dialog, props);
  const text = (id) => React.Children.toArray(nodes(tree).find((n) => n.props["data-testid"] === id).props.children).join("");
  assert.equal(text("quiz-set-delete-question"), "정말 삭제할까요?");
  assert.equal(text("quiz-set-delete-message"), "'가짜 세트' 세트와 문제 5개를 지워요. 되돌릴 수 없어요.");
  assert.equal(text("quiz-set-delete-records"), "직원 4명의 풀이 기록 12건도 같이 지워져요. 오답노트 3건도 함께 지워져요.");
  await nodes(tree).find((n) => n.props["data-testid"] === "quiz-set-delete-confirm").props.onClick();
  assert.equal(JSON.stringify(requests[0]), JSON.stringify([7, { questions: 5, answers: 12, wrongNotes: 3, staff: 4 }]));
  assert.equal(deleted, 1);
});

test("빈 세트는 직원 기록 문구 없이 확인하고, 공개 세트는 삭제 버튼이 꺼져 있다", async () => {
  const h = harness();
  const { default: Dialog } = load("./sections/QuizSetDelete.jsx", {
    react: h.hooks,
    "../ui": ui,
    "@/utils/toast": () => {},
    "@/components/lib/Modal": { __esModule: true, default: () => null, ModalBody: () => null, ModalHeader: () => null },
    "@/models/schatQuiz": {
      setDeletePreview: async () => ({ success: true, title: "빈 세트", questions: 0, answers: 0, wrongNotes: 0, staff: 0 }),
    },
  });
  const props = { set: { id: 8, title: "빈 세트" }, onClose() {} };
  h.draw(Dialog, props);
  await h.flush();
  await Promise.resolve();
  const tree = h.draw(Dialog, props);
  assert.equal(nodes(tree).some((n) => n.props["data-testid"] === "quiz-set-delete-records"), false);
  const admin = readFileSync(new URL("./sections/Quiz.jsx", import.meta.url), "utf8");
  assert.match(admin, /disabled=\{s\.status === "approved"\}/);
  assert.match(admin, /삭제하려면 먼저 상태를 사용중지로 바꿔 주세요/);
});
