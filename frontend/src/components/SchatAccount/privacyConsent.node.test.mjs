import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const React = require("react");
const { transformSync } = require("esbuild");

function load(file, deps) {
  const module = { exports: {} };
  const { code } = transformSync(readFileSync(new URL(file, import.meta.url), "utf8"), {
    loader: "jsx",
    format: "cjs",
    jsx: "automatic",
  });
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => (name in deps ? deps[name] : require(name)),
  });
  return module.exports;
}
const nodes = (tree) =>
  !React.isValidElement(tree)
    ? []
    : [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)];
function harness() {
  const slots = [];
  let cursor = 0;
  return {
    hooks: {
      ...React,
      useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
        return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }];
      },
    },
    draw(Component, props) {
      cursor = 0;
      return Component(props);
    },
  };
}
const documentV1 = {
  version: 1,
  label: "v1 · 2026.10",
  content: {
    summary: { items: "가짜 항목", purpose: "가짜 목적", retention: "가짜 보관", checklist: "가짜 체크리스트 메모", refusal: "가짜 거부" },
    external: { storage: "Google Cloud (서울 지역) 서버", generation: "가짜 Gemini 안내" },
    fullText: "가짜 전문",
  },
  items: [
    { key: "collection", label: "개인정보 수집·이용에 동의합니다." },
    { key: "external", label: "외부 서비스(Google Cloud, Google Gemini) 이용에 동의합니다." },
    { key: "noPatientInfo", label: "질문 입력창에 환자 개인정보를 입력하지 않겠습니다." },
  ],
};

test("필수 3개를 모두 체크해야 [동의하고 다음]이 눌리고, 동의 내용과 버전을 넘긴다", () => {
  const h = harness();
  const { default: Step, ConsentSteps } = load("./PrivacyConsentStep.jsx", { react: h.hooks, "./privacyConsent.css": {} });
  const agreed = [];
  let declined = 0;
  const props = { document: documentV1, onAgree: (a) => agreed.push(a), onDecline: () => declined++ };
  let tree = h.draw(Step, props);
  const all = () => nodes(tree);
  const submit = () => all().find((n) => n.type === "button" && n.props.type === "submit");
  const box = (name) => all().find((n) => n.type === "input" && n.props.name === name);
  const text = all().map((n) => (typeof n.props.children === "string" ? n.props.children : "")).join("|");
  const steps = all().find((n) => n.type === ConsentSteps);
  assert.equal(steps.props.current, 2);
  const stepItems = nodes(ConsentSteps({ current: 2 })).filter((n) => n.type === "li");
  assert.deepEqual(stepItems.map((li) => React.Children.toArray(li.props.children).join("")), ["① 직원 확인", "② 개인정보 동의", "③ 비밀번호 만들기"]);
  assert.equal(stepItems[1].props["aria-current"], "step");
  const json = JSON.stringify(tree);
  assert.ok(json.includes("질문 입력창에는 환자 이름, 등록번호, 생년월일 등 개인정보를 입력하지 마세요."));
  assert.ok(json.includes("질문은 외부 AI 서비스로 전송됩니다. 체크리스트 메모의 환자 정보는 이름을 가려 저장하며 AI로 보내지 않습니다."));
  const rows = all().filter((n) => n.type === "dt").map((n) => n.props.children);
  assert.deepEqual(rows.slice(0, 5), ["수집 항목", "이용 목적", "보관 기간", "체크리스트 메모", "거부 권리"]);
  assert.ok(JSON.stringify(tree).includes("v1 · 2026.10"));
  assert.ok(text.length > 0);
  assert.equal(submit().props.disabled, true);
  box("collection").props.onChange({ target: { checked: true } });
  box("external").props.onChange({ target: { checked: true } });
  tree = h.draw(Step, props);
  assert.equal(submit().props.disabled, true);
  box("noPatientInfo").props.onChange({ target: { checked: true } });
  tree = h.draw(Step, props);
  assert.equal(submit().props.disabled, false);
  all().find((n) => n.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(JSON.stringify(agreed), JSON.stringify([{ version: 1, items: { collection: true, external: true, noPatientInfo: true } }]));
  all().find((n) => n.type === "button" && JSON.stringify(n.props.children) === '"동의하지 않음"').props.onClick();
  assert.equal(declined, 1);
});

test("전체 보기로 동의서 전문을 펼치고, 단계 표시는 끌 수 있다", () => {
  const h = harness();
  const { default: Step } = load("./PrivacyConsentStep.jsx", { react: h.hooks, "./privacyConsent.css": {} });
  const props = { document: documentV1, showSteps: false, onAgree() {}, onDecline() {} };
  let tree = h.draw(Step, props);
  assert.equal(nodes(tree).some((n) => typeof n.type === "function" && n.type.name === "ConsentSteps"), false);
  assert.equal(nodes(tree).some((n) => n.props?.["data-testid"] === "consent-full-text"), false);
  nodes(tree).find((n) => n.props?.["aria-expanded"] === false).props.onClick();
  tree = h.draw(Step, props);
  const full = nodes(tree).find((n) => n.props?.["data-testid"] === "consent-full-text");
  assert.equal(full.props.children, "가짜 전문");
});
