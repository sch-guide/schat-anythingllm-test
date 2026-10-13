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
    { loader: "jsx", format: "cjs", jsx: "automatic" }
  );
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => (name in deps ? deps[name] : require(name)),
  });
  return module.exports;
}
const ui = load("./ui.jsx");
const deps = {
  "@/components/lib/Modal": {},
  "@/models/schatAccount": {},
  "@/utils/toast": () => {},
  "../ui": ui,
};
const section = load("./sections/Reports.jsx", deps);

test("싫어요 양식은 이유를 고르기 전 전송을 막고 메모 길이·취소·전송 잠금을 제공", () => {
  const state = [];
  let cursor = 0;
  const sent = [];
  let cancelled = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [
        state[index],
        (value) => {
          state[index] = value;
        },
      ];
    },
  };
  const { default: Form } = load(
    "../../components/WorkspaceChat/ChatContainer/ChatHistory/HistoricalMessage/Actions/DislikeForm.jsx",
    { react: hooks }
  );
  const props = {
    pending: false,
    onSubmit: (value) => sent.push(value),
    onCancel: () => cancelled++,
  };
  const draw = () => {
    cursor = 0;
    return Form(props);
  };
  const nodes = (tree) =>
    !React.isValidElement(tree)
      ? []
      : [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)];
  draw().props.onSubmit({ preventDefault() {} });
  assert.equal(sent.length, 0);
  nodes(draw())
    .find((node) => node.type === "input" && node.props.value === "not_found")
    .props.onChange();
  const memo = nodes(draw()).find(
    (node) => node.type === "input" && node.props.maxLength === 200
  );
  assert.ok(memo);
  memo.props.onChange({ target: { value: "가짜 메모" } });
  draw().props.onSubmit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [
    { reason: "not_found", memo: "가짜 메모" },
  ]);
  nodes(draw())
    .find((node) => node.type === "button" && node.props.type === "button")
    .props.onClick();
  assert.equal(cancelled, 1);
  props.pending = true;
  draw().props.onSubmit({ preventDefault() {} });
  assert.equal(sent.length, 1);
  assert.equal(
    nodes(draw()).find((node) => node.type === "fieldset").props.disabled,
    true
  );
});
test("통합 목록은 종류·질문·가린 메모·부서·날짜·상태를 보여주고 같은 번호를 구분", () => {
  assert.equal(typeof section.ReportRows, "function");
  const rows = [
    {
      id: 1,
      kind: "wrong",
      question: "가짜 질문",
      memo: "김○지님 1234****",
      department: "가짜 부서",
      createdAt: "2026-10-12",
      status: "open",
    },
    {
      id: 1,
      kind: "report",
      title: "기존 신고 제목",
      department: "가짜 부서",
      status: "resolved",
    },
  ];
  const html = renderToStaticMarkup(
    React.createElement(
      "table",
      null,
      React.createElement(section.ReportRows, {
        reports: rows,
        onSelect: () => {},
      })
    )
  );
  for (const value of [
    "👎 틀림",
    "가짜 질문",
    "김○지님 1234****",
    "신고",
    "기존 신고 제목",
    "확인 전",
    "처리 완료",
  ])
    assert.ok(html.includes(value), value);
  assert.match(html, /text-red-500/);
  assert.match(html, /text-theme-text-secondary/);
});
test("평가 상세는 전체 질문·답변·참고 지침과 쪽을 보존해 보여주고 처리 완료 동작 연결", () => {
  assert.equal(typeof section.FeedbackContent, "function");
  let resolved = 0;
  const props = {
    feedback: {
      question: "전체 가짜 질문",
      answer: "줄1\n줄2 전체 답변",
      sources: [{ title: "합성 지침.pdf", page: 9 }],
      status: "open",
    },
    onResolve: () => resolved++,
  };
  const html = renderToStaticMarkup(
    React.createElement(section.FeedbackContent, props)
  );
  for (const value of [
    "전체 가짜 질문",
    "줄1",
    "줄2 전체 답변",
    "합성 지침.pdf",
    "9쪽",
    "처리 완료",
  ])
    assert.ok(html.includes(value), value);
  const tree = section.FeedbackContent(props);
  const flatten = (node) =>
    !node || typeof node !== "object"
      ? []
      : [
          node,
          ...React.Children.toArray(node.props?.children).flatMap(flatten),
        ];
  const button = flatten(tree).find(
    (node) => node.props?.onClick === props.onResolve
  );
  assert.ok(button);
  button.props.onClick();
  assert.equal(resolved, 1);
});
test("평가 상세의 질문·답변은 왼쪽 정렬 전체 폭이고 처리 완료일 때만 삭제 버튼", () => {
  const base = {
    question: "가짜 질문",
    answer: "아주 긴 가짜 답변 ".repeat(30),
    sources: [],
  };
  const open = renderToStaticMarkup(
    React.createElement(section.FeedbackContent, {
      feedback: { ...base, status: "open" },
      onResolve: () => {},
      onDelete: () => {},
    })
  );
  assert.doesNotMatch(open, />삭제</);
  assert.doesNotMatch(open, /text-right|justify-between/);
  assert.match(open, /data-testid="report-text-block"/);
  assert.match(open, /w-full min-w-0 text-left/);
  assert.match(open, /break-words/);
  let removed = 0;
  const done = renderToStaticMarkup(
    React.createElement(section.FeedbackContent, {
      feedback: { ...base, status: "resolved" },
      onResolve: () => {},
      onDelete: () => removed++,
    })
  );
  assert.match(done, /data-testid="feedback-resolved"/);
  assert.match(done, />삭제</);
});
