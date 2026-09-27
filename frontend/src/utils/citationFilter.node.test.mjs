import test from "node:test";
import assert from "node:assert/strict";
import { filterDirectCitationSources } from "./citationFilter.js";

function source(page, excerpt) {
  return {
    page,
    pdfRef: "opaque-pdf-ref",
    documentName: "검사 및 시술(26.04.07).pdf",
    excerpt,
  };
}

test("Renal biopsy keeps the directly grounded p.56 and hides generic search candidates", () => {
  const sources = [
    source(
      56,
      "신장조직검사 Renal biopsy 검사 전 동의서와 금식여부를 확인한다."
    ),
    source(8, "검사 전 환자 준비와 확인 사항을 안내한다."),
    source(14, "환자 간호를 위한 일반적인 확인 내용이다."),
    source(30, "검사 준비와 관찰에 관한 일반적인 설명이다."),
  ];

  const result = filterDirectCitationSources({
    question: "Renal biopsy 준비 알려줘",
    answer: "Renal biopsy 검사 전에는 동의서와 금식여부를 확인합니다.",
    sources,
    aliases: ["renal biopsy", "renal bx", "신장 조직검사", "신생검"],
  });

  assert.deepEqual(
    result.map((item) => item.page),
    [56]
  );
});

test("multiple pages remain when each contains a concrete phrase used by the answer", () => {
  const sources = [
    source(56, "중심정맥관 관리 시 연결부 소독을 시행한다."),
    source(57, "드레싱 오염 여부와 삽입부 발적을 관찰한다."),
    source(8, "환자 상태를 확인하고 필요한 간호를 시행한다."),
  ];

  const result = filterDirectCitationSources({
    question: "중심정맥관 관리 방법 알려줘",
    answer:
      "중심정맥관 관리 시 연결부 소독을 시행하고 드레싱 오염 여부와 삽입부 발적을 관찰합니다.",
    sources,
  });

  assert.deepEqual(
    result.map((item) => item.page),
    [56, 57]
  );
});

test("zero confident matches falls back to every stored citation", () => {
  const sources = [source(8, "별도 자료"), source(14, "다른 자료")];
  const result = filterDirectCitationSources({
    question: "알 수 없는 질문",
    answer: "답변 내용",
    sources,
  });
  assert.equal(result, sources);
});

test("generic words alone never make a source directly relevant", () => {
  const sources = [
    source(56, "신생검 후 출혈 여부를 관찰한다."),
    source(8, "검사 준비 환자 간호 확인"),
  ];
  const result = filterDirectCitationSources({
    question: "신생검 검사 후 간호 알려줘",
    answer: "신생검 후 출혈 여부를 관찰합니다.",
    sources,
    aliases: ["renal biopsy", "renal bx", "신장 조직검사", "신생검"],
  });
  assert.deepEqual(
    result.map((item) => item.page),
    [56]
  );
});

test("an alias-bearing page wins over a generic page even when the generic page shares an answer phrase", () => {
  const sources = [
    source(56, "신장조직검사 Renal biopsy 동의서와 검사 전 준비를 확인한다."),
    source(8, "검사 전 준비를 확인하고 환자에게 검사 과정을 설명한다."),
  ];
  const result = filterDirectCitationSources({
    question: "Renal biopsy 준비 알려줘",
    answer: "검사 전 준비를 확인하고 동의서와 금식 여부를 확인합니다.",
    sources,
    aliases: ["renal biopsy", "renal bx", "신장 조직검사", "신생검"],
  });
  assert.deepEqual(
    result.map((item) => item.page),
    [56]
  );
});
