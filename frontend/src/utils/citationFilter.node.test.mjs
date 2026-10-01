import test from "node:test";
import assert from "node:assert/strict";
import * as citationFilter from "./citationFilter.js";
const { filterDirectCitationSources, buildCitationDisplay } = citationFilter;

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

test("zero confident matches never presents all retrieved sources as direct evidence", () => {
  const sources = [source(8, "별도 자료"), source(14, "다른 자료")];
  const result = filterDirectCitationSources({
    question: "알 수 없는 질문",
    answer: "답변 내용",
    sources,
  });
  assert.deepEqual(result, []);
});

test("CT and MRI each keep their own fasting evidence, not another procedure's NPO", () => {
  const sources = [source(2, "컴퓨터단층촬영CT\n금식여부\n조영제검사8시간금식"),
    source(3, "자기공명검사MRI\n금식여부\n복부검사6시간금식"),
    source(56, "신장조직검사Renalbiopsy\n금식여부 MN NPO"),
    source(6, "방광결석 수술\n금식여부 MN NPO\n수술후 CT 확인")];
  const snapshot = JSON.stringify(sources);
  const result = buildCitationDisplay({ question: "조영제 CT 전 금식 몇 시간? MRI는?",
    answer: "CT 조영제 검사는 8시간 금식, MRI 복부 검사는 6시간 금식입니다.", sources,
    aliases: ["CT", "컴퓨터단층촬영"] });
  assert.deepEqual(result.sources.map(s => s.page), [2, 3]);
  assert.deepEqual(result.missingTopics, []);
  assert.equal(JSON.stringify(sources), snapshot);
});

test("a missing MRI source is disclosed without discarding the available CT source", () => {
  const result = buildCitationDisplay({ question: "CT 금식? MRI는?", answer: "CT 금식은 8시간입니다. MRI도 확인하세요.",
    sources: [source(2, "컴퓨터단층촬영CT\n금식 8시간")] });
  assert.deepEqual(result.sources.map(s=>s.page), [2]);
  assert.deepEqual(result.missingTopics, ["MRI"]);
});

test("RI refusal hides every source including insulin background material", () => {
  const result = buildCitationDisplay({question:"혈당 280일 때 RI 몇 단위?",
    answer:"등록된 문서에서 확인되지 않습니다. 담당자에게 확인해 주세요.",
    sources:[source(167,"혈당 RI 인슐린 관리") ]});
  assert.equal(result.mode,"no-evidence");
  assert.deepEqual(result.sources,[]);
  assert.deepEqual(result.references,[]);
});

test("substantive answer without direct evidence only offers clearly separated references", () => {
  const sources=[source(8,"다른 자료")];
  const result=buildCitationDisplay({question:"알 수 없는 질문",answer:"구체적인 답변 내용",sources});
  assert.equal(result.mode,"unverified");
  assert.deepEqual(result.sources,[]);
  assert.deepEqual(result.references,sources);
});

test("incidental CT mention in another checklist does not qualify as CT fasting evidence", () => {
  const result=buildCitationDisplay({question:"CT 금식 시간?",answer:"CT 검사 전 금식 시간 확인이 필요합니다.",
    sources:[source(56,"신장조직검사Renalbiopsy\n검사 전 준비 CT 결과 확인\n금식여부 MN NPO")]});
  assert.deepEqual(result.sources,[]);
  assert.deepEqual(result.missingTopics,["CT"]);
});

test("a generic fasting phrase is not enough even when repeated verbatim in the answer", () => {
  const result=buildCitationDisplay({question:"CT 금식?", answer:"CT 검사 준비: 금식여부 MN NPO 확인.",
    sources:[source(6,"방광결석\n금식여부 MN NPO 확인.")]});
  assert.deepEqual(result.sources,[]);
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

test("picture question keeps a picture source about the question subject", () => {
  const picture = {
    ...source(115, "가상 수혈 제품 사진 설명"),
    relatedImages: [{ imageKey: "a".repeat(64), page: 115 }],
  };
  const unrelatedPicture = {
    ...source(30, "가상 입원 절차 흐름도"),
    relatedImages: [{ imageKey: "b".repeat(64), page: 30 }],
  };
  const text = source(125, "가상 수혈 세트는 필터가 있는 세트를 사용한다.");
  const answer = "가상 수혈 세트는 필터가 있는 세트를 사용합니다.";

  const result = filterDirectCitationSources({
    question: "수혈 세트 그림 보여줘",
    answer,
    sources: [text, picture, unrelatedPicture],
  });
  assert.deepEqual(
    result.map((item) => item.page),
    [125, 115]
  );

  // the same sources for a non-picture question keep the old rule
  const plain = filterDirectCitationSources({
    question: "수혈 세트 알려줘",
    answer,
    sources: [text, picture, unrelatedPicture],
  });
  assert.deepEqual(
    plain.map((item) => item.page),
    [125]
  );
});
