import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { setImmediate } from "node:timers/promises";
import { promptInheritance } from "./promptInheritance.js";
const require = createRequire(import.meta.url);
const React = require("react");
const { transformSync } = require("esbuild");

function setup() {
  let slots = [],
    cursor = 0,
    effects = [];
  const calls = [];
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (v) => (slots[i] = v)];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((v, j) => v !== slots[i][j])) {
        slots[i] = deps;
        effects.push(fn);
      }
    },
  };
  const deps = {
    react: hooks,
    "@/models/system": {
      fetchDefaultSystemPrompt: async () => ({
        defaultSystemPrompt: "가짜 기본 규칙",
      }),
      updateDefaultSystemPrompt: async (value) => {
        calls.push(["rules", value]);
        return { success: true };
      },
    },
    "@/models/workspace": {
      update: async (slug, values) => {
        calls.push([slug, values]);
        return { workspace: { slug, ...values } };
      },
    },
    "@/utils/toast": () => {},
    "../promptInheritance": { promptInheritance },
    "../ui": {
      inputClass: "",
      ...Object.fromEntries(
        ["Badge", "Button", "Card", "Field", "Loading", "Notice"].map(
          (name) => [
            name,
            ({ children }) => React.createElement("div", null, children),
          ]
        )
      ),
    },
  };
  const module = { exports: {} };
  const { code } = transformSync(
    readFileSync(new URL("./sections/Answer.jsx", import.meta.url), "utf8"),
    { loader: "jsx", format: "cjs", jsx: "automatic" }
  );
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => (name in deps ? deps[name] : require(name)),
  });
  const children = React.Children.toArray(
    module.exports.default({ workspace: { slug: "test", openAiTemp: 2 } }).props
      .children
  );
  function render(component, props) {
    cursor = 0;
    effects = [];
    const tree = component(props);
    effects.forEach((fn) => fn());
    return tree;
  }
  return { children, calls, render };
}
function nodes(tree) {
  return !React.isValidElement(tree)
    ? []
    : [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)];
}

test("저장된 값 2가 있어도 답변 설정은 대화 참고 수와 규칙만 제공한다", () => {
  const s = setup();
  assert.deepEqual(
    s.children.map((el) => el.type.name),
    ["HistoryCount", "AnswerRules"]
  );
  assert.equal(s.calls.length, 0);
});
test("이전 대화 수 저장은 기존 항목만 변경한다", async () => {
  const s = setup();
  const component = s.children[0].type;
  const props = {
    workspace: { slug: "test", openAiHistory: 20, openAiTemp: 2 },
  };
  let tree = s.render(component, props);
  nodes(tree)
    .find((el) => el.props.id === "schat-history-count")
    .props.onChange({ target: { value: "12" } });
  tree = s.render(component, props);
  await nodes(tree)
    .find((el) => el.type === "form")
    .props.onSubmit({ preventDefault() {} });
  assert.equal(
    JSON.stringify(s.calls),
    JSON.stringify([["test", { openAiHistory: 12 }]])
  );
  assert.equal(props.workspace.openAiTemp, 2);
});
test("답변 규칙 읽기와 저장은 그대로 동작한다", async () => {
  const s = setup();
  const component = s.children[1].type;
  const props = {
    workspace: { slug: "test", openAiPrompt: null, openAiTemp: 2 },
  };
  s.render(component, props);
  await setImmediate();
  let tree = s.render(component, props);
  const field = nodes(tree).find((el) => el.props.id === "schat-answer-rules");
  assert.equal(field.props.value, "가짜 기본 규칙");
  field.props.onChange({ target: { value: " 새 가짜 규칙 " } });
  tree = s.render(component, props);
  await nodes(tree)
    .find((el) => el.type === "form")
    .props.onSubmit({ preventDefault() {} });
  assert.equal(
    JSON.stringify(s.calls),
    JSON.stringify([["rules", "새 가짜 규칙"]])
  );
  assert.equal(props.workspace.openAiTemp, 2);
});
