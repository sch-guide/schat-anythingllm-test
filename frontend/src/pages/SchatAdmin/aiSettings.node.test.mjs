import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformSync } from "esbuild";
const require = createRequire(import.meta.url);
const React = require("react");
function load(file, deps = {}) {
  const module = { exports: {} };
  const code = transformSync(
    readFileSync(new URL(file, import.meta.url), "utf8"),
    { loader: "jsx", format: "cjs", jsx: "automatic" }
  ).code;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    console,
    require: (name) =>
      name in deps ? { __esModule: true, ...deps[name] } : require(name),
  });
  return module.exports;
}
function setup(api = {}) {
  let cursor = 0,
    slots = [],
    effects = [];
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === "function" ? initial() : initial;
      return [
        slots[index],
        (next) =>
          (slots[index] =
            typeof next === "function" ? next(slots[index]) : next),
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (slots[index] ||= { current: initial });
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (
        !slots[index] ||
        deps.some((value, i) => !Object.is(value, slots[index][i]))
      ) {
        slots[index] = deps;
        effects.push(effect);
      }
    },
  };
  const toasts = [];
  const calls = [];
  const deps = {
    react: hooks,
    "@/models/system": { default: { keys: async () => null } },
    "@/models/workspace": { default: {} },
    "@/utils/toast": { default: (...args) => toasts.push(args) },
    "../promptInheritance": { promptInheritance: () => ({}) },
  };
  deps["../ui"] = load("./ui.jsx", { react: hooks });
  deps["@/models/schatAdmin"] = {
    default: {
      aiModels: async (input) => {
        calls.push(["models", input]);
        return {
          ok: true,
          models: ["gemini-old", "gemini-new"],
          revision: "r1",
        };
      },
      saveAiSettings: async (input) => {
        calls.push(["save", input]);
        return { ok: true, revision: "r2" };
      },
      ...api,
    },
  };
  const module = load("./sections/Connections.jsx", deps);
  const props = {
    target: "llm",
    info: { provider: "gemini", model: "gemini-old", keySet: true },
    revision: "r1",
    onSaved: () => calls.push(["saved"]),
  };
  return {
    toasts,
    calls,
    props,
    module,
    deps,
    render() {
      cursor = 0;
      effects = [];
      const tree = module.ConnectionCard(props);
      for (const effect of effects) effect();
      return tree;
    },
    renderAnswer() {
      cursor = 0;
      effects = [];
      return load("./sections/Answer.jsx", deps).default({
        workspace: { slug: "test" },
      });
    },
  };
}
function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)];
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  return [
    tree.props?.title,
    tree.props?.description,
    tree.props?.help,
    tree.props?.label,
    tree.props?.children,
  ]
    .flat(Infinity)
    .map(text)
    .join(" ");
}
function button(tree, label) {
  const found = elements(tree).find(
    (node) =>
      typeof node.props?.onClick === "function" && text(node).includes(label)
  );
  assert.ok(found, `버튼 없음: ${label}`);
  return found;
}
function field(tree, id) {
  return elements(tree).find((node) => node.props?.id === id);
}
function form(tree) {
  return elements(tree).find((node) => node.type === "form");
}

test("답변 설정에는 대화 참고와 답변 규칙만 남는다", () => {
  const s = setup();
  const tree = s.renderAnswer();
  assert.deepEqual(
    elements(tree)
      .filter((node) => typeof node.type === "function")
      .map((node) => node.type.name),
    ["HistoryCount", "AnswerRules"]
  );
});

test("AI 설정에서 목록 선택과 빈 열쇠 유지 안내를 표시하고 목록 실패시 저장을 막는다", async () => {
  const s = setup({
    aiModels: async () => ({ ok: false, message: "목록 확인 실패" }),
  });
  let tree = s.render();
  assert.match(text(tree), /거의 안 씀/);
  await button(tree, "모델·열쇠 변경").props.onClick();
  tree = s.render();
  assert.equal(field(tree, "schat-answer-model").type, "select");
  assert.equal(field(tree, "schat-key-llm").props.type, "password");
  assert.match(text(tree), /비워 두면 기존/);
  assert.equal(
    elements(tree).find((node) => node.props?.type === "submit").props.disabled,
    true
  );
  assert.match(text(tree), /목록 확인 실패/);
});

test("모델 목록은 새 열쇠 입력 후 다시 조회하고 후보 값으로 저장하며 성공 후 열쇠를 지운다", async () => {
  const s = setup();
  let tree = s.render();
  await button(tree, "모델·열쇠 변경").props.onClick();
  tree = s.render();
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0])), [
    "models",
    { revision: "r1" },
  ]);
  field(tree, "schat-key-llm").props.onChange({
    target: { value: "new-secret" },
  });
  tree = s.render();
  assert.equal(
    elements(tree).find((node) => node.props?.type === "submit").props.disabled,
    true
  );
  await button(tree, "모델 목록 확인").props.onClick();
  tree = s.render();
  field(tree, "schat-answer-model").props.onChange({
    target: { value: "gemini-new" },
  });
  tree = s.render();
  await form(tree).props.onSubmit({ preventDefault() {} });
  tree = s.render();
  assert.deepEqual(
    s.calls.map((call) => JSON.parse(JSON.stringify(call))),
    [
      ["models", { revision: "r1" }],
      ["models", { revision: "r1", apiKey: "new-secret" }],
      [
        "save",
        {
          target: "llm",
          model: "gemini-new",
          apiKey: "new-secret",
          revision: "r1",
        },
      ],
      ["saved"],
    ]
  );
  assert.equal(field(tree, "schat-key-llm"), undefined);
  assert.doesNotMatch(text(tree), /new-secret/);
});

test("연결 실패에는 기존 모델 표시와 편집값을 유지하고 저장 중 중복 요청을 막는다", async () => {
  let release;
  let saves = 0;
  const s = setup({
    saveAiSettings: async () => {
      saves++;
      return await new Promise((resolve) => (release = resolve));
    },
  });
  let tree = s.render();
  await button(tree, "모델·열쇠 변경").props.onClick();
  tree = s.render();
  field(tree, "schat-answer-model").props.onChange({
    target: { value: "gemini-new" },
  });
  tree = s.render();
  const submit = form(tree).props.onSubmit;
  const pending = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  assert.equal(saves, 1);
  assert.equal(
    elements(s.render()).find((node) => node.props?.type === "submit").props
      .disabled,
    true
  );
  release({ ok: false, message: "연결 실패, 이전 설정 유지" });
  await pending;
  tree = s.render();
  assert.match(text(tree), /gemini-old/);
  assert.match(text(tree), /이전 설정 유지/);
  assert.equal(field(tree, "schat-answer-model").props.value, "gemini-new");
  assert.equal(
    s.calls.some((call) => call[0] === "saved"),
    false
  );
});

test("오래된 목록 응답과 취소한 편집기의 늦은 응답은 새 입력에 반영하지 않는다", async () => {
  const stale = setup({
    aiModels: async () => ({
      ok: true,
      models: ["gemini-new"],
      revision: "changed",
    }),
  });
  await button(stale.render(), "모델·열쇠 변경").props.onClick();
  assert.match(text(stale.render()), /화면을 다시 열어/);
  assert.equal(
    elements(stale.render()).find((node) => node.props?.type === "submit").props
      .disabled,
    true
  );
  let release;
  const s = setup({
    aiModels: async () => await new Promise((resolve) => (release = resolve)),
  });
  const pending = button(s.render(), "모델·열쇠 변경").props.onClick();
  button(s.render(), "취소").props.onClick();
  release({ ok: true, models: ["gemini-new"], revision: "r1" });
  await pending;
  assert.equal(field(s.render(), "schat-key-llm"), undefined);
  assert.equal(form(s.render()), undefined);
});
