import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const require = createRequire(import.meta.url);

// Only the React hook lifecycle and external operations are replaced. The
// production component, handlers, JSX, and UI building blocks stay real.
const hooks = `
let slots=[], cursor=0, pending=[];
export function begin(){cursor=0; pending=[];}
export function flush(){for(const effect of pending) effect();}
export function useState(initial){const index=cursor++; if(!(index in slots)) slots[index]=typeof initial==='function'?initial():initial; return [slots[index], next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];}
export function useEffect(effect, deps){const index=cursor++; if(!slots[index] || deps.some((value,i)=>!Object.is(value,slots[index][i]))){slots[index]=deps; pending.push(effect);}}
`;

async function loadAdvanced() {
  const result = await build({
    stdin: {
      contents: `import * as Answer from './src/pages/SchatAdmin/sections/Answer.jsx'; import {begin,flush} from 'answer-test-hooks'; export const Advanced=Answer.Advanced; export function render(props){begin(); let tree=Answer.Advanced(props); flush(); begin(); tree=Answer.Advanced(props); flush(); return tree;}`,
      resolveDir: root,
      loader: "jsx",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["react/jsx-runtime"],
    jsx: "automatic",
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
    alias: { "@": path.join(root, "src") },
    plugins: [
      {
        name: "isolated-answer-settings",
        setup(api) {
          api.onResolve({ filter: /^(react|answer-test-hooks)$/ }, () => ({
            path: "hooks",
            namespace: "test",
          }));
          api.onLoad({ filter: /.*/, namespace: "test" }, () => ({
            contents: hooks,
            loader: "js",
          }));
          api.onLoad(
            { filter: /models[\\/](system|workspace)\.js$/ },
            ({ path: file }) => ({
              contents: file.endsWith("workspace.js")
                ? "export default {update:(...args)=>globalThis.__answerTest.update(...args)}"
                : "export default {keys:async()=>null}",
              loader: "js",
            })
          );
          api.onLoad({ filter: /utils[\\/]toast\.js$/ }, () => ({
            contents:
              "export default (...args)=>globalThis.__answerTest.toasts.push(args)",
            loader: "js",
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(
    module,
    module.exports,
    require
  );
  assert.equal(
    typeof module.exports.Advanced,
    "function",
    "고급 설정을 실제로 렌더하고 저장 동작을 검사할 수 있어야 합니다."
  );
  return module.exports;
}

function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)];
}

function input(tree) {
  return elements(tree).find(
    (element) => element.props?.id === "schat-answer-temperature"
  );
}

function button(tree) {
  return elements(tree).find((element) => element.props?.type === "submit");
}

function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  return [tree.props?.label, tree.props?.help, tree.props?.children]
    .flat(Infinity)
    .map(text)
    .join(" ");
}

function setup() {
  const calls = [];
  const state = {
    calls,
    toasts: [],
    update: async (...args) => {
      calls.push(args);
      return { workspace: { slug: args[0], ...args[1] }, message: null };
    },
  };
  globalThis.__answerTest = state;
  return state;
}

const settings = {
  LLMProvider: "gemini",
  GeminiLLMModelPref: "gemini-3.8-flash",
};

test("현재 온도와 기본값을 표시하며 작업 공간 변경 시 편집값을 재설정한다", async () => {
  setup();
  const view = await loadAdvanced();
  const props = { workspace: { slug: "first", openAiTemp: 0.7 }, settings };
  let tree = view.render(props);
  assert.equal(input(tree).props.value, 0.7);
  assert.equal(button(tree).props.disabled, true);
  input(tree).props.onChange({ target: { value: "1.5" } });
  tree = view.render(props);
  assert.equal(input(tree).props.value, "1.5");
  assert.equal(button(tree).props.disabled, false);
  tree = view.render({
    ...props,
    workspace: { slug: "second", openAiTemp: 0.7 },
  });
  assert.equal(input(tree).props.value, 0.7);
  tree = view.render({
    ...props,
    workspace: { slug: "second", openAiTemp: 0 },
  });
  assert.equal(input(tree).props.value, 0);
  tree = view.render({
    ...props,
    workspace: { slug: "third", openAiTemp: null },
  });
  assert.equal(input(tree).props.value, 0.7);
  assert.equal(button(tree).props.disabled, true);
  assert.match(text(tree), /현재 적용 값[\s\S]*0\.7/);
});

test("온도는 양 끝값과 소수를 저장하며 seed를 요청에 추가하지 않는다", async () => {
  const state = setup();
  const view = await loadAdvanced();
  let saved = 0;
  const props = {
    workspace: { slug: "sample", openAiTemp: 0.7 },
    settings,
    onSaved: () => saved++,
  };
  for (const value of ["0", "2", "1.25"]) {
    input(view.render(props)).props.onChange({ target: { value } });
    await elements(view.render(props))
      .find((element) => element.type === "form")
      .props.onSubmit({ preventDefault() {} });
  }
  assert.deepEqual(state.calls, [
    ["sample", { openAiTemp: 0 }],
    ["sample", { openAiTemp: 2 }],
    ["sample", { openAiTemp: 1.25 }],
  ]);
  assert.equal(saved, 3);
  assert.equal(state.toasts.filter(([, tone]) => tone === "success").length, 3);
});

test("빈값·공백·범위 밖·유한하지 않은 온도는 저장하지 않는다", async () => {
  const state = setup();
  const view = await loadAdvanced();
  const props = { workspace: { slug: "sample", openAiTemp: 0.7 }, settings };
  for (const value of [
    "",
    " ",
    "\t",
    "-0.1",
    "2.1",
    "Infinity",
    "NaN",
    "abc",
  ]) {
    input(view.render(props)).props.onChange({ target: { value } });
    const tree = view.render(props);
    assert.equal(button(tree).props.disabled, true, JSON.stringify(value));
    await elements(tree)
      .find((element) => element.type === "form")
      .props.onSubmit({ preventDefault() {} });
  }
  assert.deepEqual(state.calls, []);
  assert.equal(state.toasts.length, 8);
  assert.ok(state.toasts.every(([, tone]) => tone === "error"));
});

test("저장 실패는 성공으로 표시하지 않고 다시 저장할 수 있다", async () => {
  const state = setup();
  const view = await loadAdvanced();
  let saved = 0;
  const props = {
    workspace: { slug: "sample", openAiTemp: 0.7 },
    settings,
    onSaved: () => saved++,
  };
  input(view.render(props)).props.onChange({ target: { value: "1" } });
  for (const fail of [
    async () => ({ workspace: null, message: "실패" }),
    async () => {
      throw new Error("연결 실패");
    },
  ]) {
    state.update = fail;
    await elements(view.render(props))
      .find((element) => element.type === "form")
      .props.onSubmit({ preventDefault() {} });
    assert.equal(button(view.render(props)).props.disabled, false);
  }
  assert.equal(saved, 0);
  assert.deepEqual(
    state.toasts.map(([, tone]) => tone),
    ["error", "error"]
  );
});

test("검증된 Gemini 연결은 seed 사용 안 함과 거절 이유를 표시하고 비활성화한다", async () => {
  setup();
  const view = await loadAdvanced();
  const tree = view.render({
    workspace: { slug: "sample", openAiTemp: 0.7 },
    settings,
  });
  const control = elements(tree).find(
    (element) => element.props?.id === "schat-answer-seed"
  );
  assert.equal(control?.props.disabled, true);
  assert.match(text(tree), /사용 안 함/);
  assert.match(
    text(tree),
    /현재 Gemini 호환 연결에서 seed 포함 요청이 거절되어 활성화하지 않음/
  );
  assert.match(text(tree), /1\.0/);
  assert.match(text(tree), /낮춰도[\s\S]*정확[\s\S]*(같은|동일)/);
});

test("다른 모델이나 제공 서비스는 지원 미확인으로 안내한다", async () => {
  setup();
  const view = await loadAdvanced();
  for (const workspace of [
    { slug: "other-model", chatModel: "gemini-other" },
    {
      slug: "other-provider",
      chatProvider: "openai",
      chatModel: "gemini-3.8-flash",
    },
  ]) {
    const tree = view.render({ workspace, settings });
    assert.match(text(tree), /현재 연결에서 지원 미확인/);
    assert.doesNotMatch(text(tree), /seed 포함 요청이 거절/);
    assert.equal(
      elements(tree).find(
        (element) => element.props?.id === "schat-answer-seed"
      )?.props.disabled,
      true
    );
  }
  assert.match(
    text(view.render({ workspace: { slug: "unknown" }, settings: null })),
    /현재 연결에서 지원 미확인/
  );
});
