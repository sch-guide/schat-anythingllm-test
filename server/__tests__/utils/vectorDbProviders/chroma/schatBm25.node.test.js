const test = require("node:test");
const assert = require("node:assert/strict");

const {
  tokenize,
  queryTokens,
  rankByBm25,
  fuseGeminiAndBm25,
  filterWeakHybridTail,
  addHeadingContinuationCandidates,
  addProcedureWorkflowCandidates,
  evidenceResultLimit,
  limitImageDescriptionCandidates,
} = require("../../../../utils/vectorDbProviders/chroma/schatBm25");

test("image descriptions cannot displace more than one text result", () => {
  const candidates = [
    { id: "image-1", metadata: { content_type: "image_description" } },
    { id: "text-1", metadata: {} },
    { id: "image-2", metadata: { content_type: "image_description" } },
    { id: "text-2", metadata: {} },
  ];

  assert.deepEqual(
    limitImageDescriptionCandidates(candidates, { maxImageResults: 1 }).map(
      (candidate) => candidate.id
    ),
    ["image-1", "text-1", "text-2"]
  );
});

test("hybrid topN backfills text evidence after the image-description cap", () => {
  const vectorRanked = [
    {
      id: "image-1",
      text: "카테터 절차도",
      metadata: { content_type: "image_description" },
      vectorScore: 0.95,
    },
    {
      id: "image-2",
      text: "카테터 연결 그림",
      metadata: { content_type: "image_description" },
      vectorScore: 0.94,
    },
    {
      id: "text-1",
      text: "카테터 연결 절차",
      metadata: {},
      vectorScore: 0.93,
    },
  ];

  assert.deepEqual(
    fuseGeminiAndBm25(vectorRanked, [], {
      topN: 2,
      queryText: "카테터",
      maxImageResults: 1,
    }).map((candidate) => candidate.id),
    ["image-1", "text-1"]
  );
});

test("한글·영문·숫자를 검색 토큰으로 보존한다", () => {
  assert.deepEqual(tokenize("수혈 전 Hb 8.0 g/dL 확인"), [
    "수혈",
    "전",
    "hb",
    "8.0",
    "g",
    "dl",
    "확인",
  ]);
});

test("질문의 조사와 요청 표현을 제거해 병원 핵심어만 남긴다", () => {
  assert.deepEqual(queryTokens("비터널형 카테터는 뭐야?"), [
    "비터널형",
    "카테터",
  ]);
  assert.deepEqual(queryTokens("수혈 종류 알려줘"), ["수혈", "종류"]);
});

test("검색 후 근거 선택은 요청 표현과 제한적 활용형 때문에 임상 근거를 버리지 않는다", () => {
  const candidate = (id, text, vectorScore = 0.64) => ({
    id,
    text,
    metadata: { content_type: "text" },
    vectorScore,
    retrieval: { bm25Coverage: 0.25, vectorScore },
  });

  assert.deepEqual(
    filterWeakHybridTail(
      [candidate("sedation", "진정 시행 후 활력징후와 산소포화도를 관찰한다")],
      { queryText: "진정할 때 주의할 점은?" }
    ).map(({ id }) => id),
    ["sedation"]
  );
  assert.deepEqual(
    filterWeakHybridTail(
      [candidate("transfusion", "수혈간호 절차와 확인사항")],
      { queryText: "수혈간호를 전체적으로 핵심 요약해줘" }
    ).map(({ id }) => id),
    ["transfusion"]
  );
  assert.deepEqual(
    filterWeakHybridTail(
      [candidate("follow-up", "진정 후 환자 상태를 평가하고 모니터링한다")],
      { queryText: "그중 진정 후에는 어떻게 관찰해?" }
    ).map(({ id }) => id),
    ["follow-up"]
  );
});

test("목차의 점선 항목은 broad 질문의 답변 근거로 선택하지 않는다", () => {
  const kept = filterWeakHybridTail(
    [
      {
        id: "toc",
        text: "11. 수혈간호············ 237",
        vectorScore: 0.8,
        retrieval: { bm25Coverage: 1, vectorScore: 0.8 },
      },
      {
        id: "body",
        text: "11. 수혈간호 절차와 확인사항",
        vectorScore: 0.64,
        retrieval: { bm25Coverage: 0.25, vectorScore: 0.64 },
      },
    ],
    { queryText: "수혈간호를 전체적으로 핵심 요약해줘" }
  );
  assert.deepEqual(kept.map(({ id }) => id), ["body"]);
});

test("텍스트 절차 질문은 이미지 설명만 남기지 않고 본문 근거를 우선한다", () => {
  const result = fuseGeminiAndBm25(
    [
      {
        id: "fall-image",
        text: "낙상 위험 환자의 진정 주의 화면",
        metadata: { content_type: "image_description", page: 75 },
        vectorScore: 0.82,
      },
      {
        id: "sedation-body",
        text: "진정 진행 중 모니터링과 시행 후 관찰",
        metadata: { content_type: "text", page: 161 },
        vectorScore: 0.66,
      },
    ],
    [],
    { topN: 1, queryText: "진정은 어떻게 진행하는 거야?", maxImageResults: 1 }
  );
  assert.deepEqual(result.map(({ id }) => id), ["sedation-body"]);
});

test("대해·대해서·관해는 질문 핵심어를 희석하지 않는다", () => {
  assert.deepEqual(queryTokens("FPRS에 대해 알려줘"), ["fprs"]);
  assert.deepEqual(queryTokens("FPRS에 대해서 알려줘"), ["fprs"]);
  assert.deepEqual(queryTokens("FPRS에 관해 알려줘"), ["fprs"]);
});

test("붙여 쓴 주제와 질문 의도를 일반 접미사 규칙으로 분리한다", () => {
  assert.deepEqual(queryTokens("수혈종류"), ["수혈", "종류"]);
  assert.deepEqual(queryTokens("수혈의종류"), ["수혈", "종류"]);
  assert.deepEqual(queryTokens("진정절차"), ["진정", "절차"]);
  assert.deepEqual(queryTokens("수혈준비사항"), ["수혈", "준비사항"]);
  assert.equal(evidenceResultLimit("진정절차", 4), 6);
});

test("어떻게 해 형태의 자연스러운 질문도 일반 절차 질문으로 인식한다", () => {
  assert.equal(evidenceResultLimit("수혈은 어떻게 해?", 4), 6);
});

test("어떻게 시행·투여하나요는 절차로 보지만 평가 질문은 오인하지 않는다", () => {
  assert.equal(evidenceResultLimit("수혈은 어떻게 시행하나요?", 4), 6);
  assert.equal(evidenceResultLimit("약물은 어떻게 투여하나요?", 4), 6);
  assert.equal(evidenceResultLimit("NRS 어떻게 평가해?", 4), 4);
});

test("정확한 병원 용어가 있는 청크를 BM25 상위에 둔다", () => {
  const documents = [
    { id: "a", text: "일반적인 환자 확인 절차", metadata: {} },
    { id: "b", text: "수혈 동의서 작성 시점과 확인 절차", metadata: {} },
    { id: "c", text: "투약 동의서 작성 절차", metadata: {} },
  ];

  const ranked = rankByBm25("수혈 동의서 작성 시점", documents);

  assert.equal(ranked[0].id, "b");
  assert.ok(ranked[0].bm25Score > ranked[1].bm25Score);
});

test("조사만 붙은 용어는 일치하되 무수혈·수혈거부 합성어는 수혈과 일치하지 않는다", () => {
  const documents = [
    { id: "exact", text: "수혈은 처방을 확인한다.", metadata: {} },
    { id: "particle", text: "수혈을 시작한다.", metadata: {} },
    { id: "compound-prefix", text: "무수혈 치료를 시행한다.", metadata: {} },
    { id: "compound-suffix", text: "수혈거부 환자를 확인한다.", metadata: {} },
  ];

  assert.deepEqual(
    rankByBm25("수혈", documents)
      .map(({ id }) => id)
      .sort(),
    ["exact", "particle"]
  );
  assert.deepEqual(
    rankByBm25("수혈은", documents)
      .map(({ id }) => id)
      .sort(),
    ["exact", "particle"]
  );
});

test("Gemini 순위를 우선하면서 BM25 정확 용어가 중간 순위를 보완한다", () => {
  const vectorRanked = [
    { id: "a", text: "수혈 절차", metadata: {}, vectorScore: 0.95 },
    { id: "b", text: "환자 확인", metadata: {}, vectorScore: 0.9 },
    {
      id: "c",
      text: "수혈 동의서 작성 시점",
      metadata: {},
      vectorScore: 0.82,
    },
  ];
  const bm25Ranked = [
    { id: "c", text: "수혈 동의서 작성 시점", metadata: {}, bm25Score: 4 },
    { id: "a", text: "수혈 절차", metadata: {}, bm25Score: 1 },
  ];

  const fused = fuseGeminiAndBm25(vectorRanked, bm25Ranked, {
    topN: 3,
    vectorWeight: 0.75,
    bm25Weight: 0.25,
  });

  assert.deepEqual(
    fused.map((item) => item.id),
    ["a", "c", "b"]
  );
  assert.equal(fused[0].retrieval.vectorRank, 1);
  assert.equal(fused[1].retrieval.bm25Rank, 1);
});

test("동점이면 기존 문서 순서와 ID 순으로 항상 같은 결과를 낸다", () => {
  const documents = [
    { id: "b", text: "동일 용어", metadata: {}, corpusPosition: 0 },
    { id: "a", text: "동일 용어", metadata: {}, corpusPosition: 0 },
    { id: "c", text: "동일 용어", metadata: {}, corpusPosition: 2 },
  ];

  const first = rankByBm25("동일 용어", documents).map((item) => item.id);
  const second = rankByBm25("동일 용어", documents).map((item) => item.id);

  assert.deepEqual(first, ["a", "b", "c"]);
  assert.deepEqual(second, first);
});

test("질문 단어의 절반 이상이 정확히 일치하면 BM25 보완 근거로 유지한다", () => {
  const ranked = rankByBm25("Hb 수혈 기준", [
    { id: "exact", text: "Hb 수혈 기준 안내", metadata: {} },
    { id: "weak", text: "일반 수혈 절차", metadata: {} },
  ]);

  assert.equal(ranked[0].id, "exact");
  assert.ok(ranked[0].bm25Coverage >= 0.5);
  assert.ok(ranked[1].bm25Coverage < 0.5);
});

test("의미 점수 차이가 크고 정확 단어 일치도도 낮은 꼬리 결과만 제거한다", () => {
  const filtered = filterWeakHybridTail([
    {
      id: "best",
      vectorScore: 0.91,
      retrieval: { vectorRank: 1, bm25Rank: 1, bm25Coverage: 0.75 },
    },
    {
      id: "semantic-near",
      vectorScore: 0.81,
      retrieval: { vectorRank: 2, bm25Rank: null, bm25Coverage: 0 },
    },
    {
      id: "exact-abbreviation",
      vectorScore: null,
      retrieval: { vectorRank: null, bm25Rank: 2, bm25Coverage: 1 },
    },
    {
      id: "irrelevant-tail",
      vectorScore: 0.48,
      retrieval: { vectorRank: 3, bm25Rank: 3, bm25Coverage: 0.25 },
    },
  ]);

  assert.deepEqual(
    filtered.map((item) => item.id),
    ["best", "semantic-near", "exact-abbreviation"]
  );
});

test("weak vector-only first result is not forced into employee context", () => {
  const filtered = filterWeakHybridTail([
    {
      id: "weak-semantic",
      vectorScore: 0.55,
      retrieval: { vectorRank: 1, bm25Rank: null, bm25Coverage: 0 },
    },
  ]);
  assert.deepEqual(filtered, []);
});

test("strong semantic or exact keyword evidence is preserved", () => {
  const filtered = filterWeakHybridTail([
    {
      id: "strong-semantic",
      vectorScore: 0.72,
      retrieval: { vectorRank: 1, bm25Rank: null, bm25Coverage: 0 },
    },
    {
      id: "exact-keyword",
      vectorScore: 0.42,
      retrieval: { vectorRank: 2, bm25Rank: 1, bm25Coverage: 1 },
    },
  ]);
  assert.deepEqual(
    filtered.map((item) => item.id),
    ["strong-semantic", "exact-keyword"]
  );
});

test("one generic word out of a two-word question does not rescue weak evidence", () => {
  const filtered = filterWeakHybridTail([
    {
      id: "generic-purpose-only",
      vectorScore: 0.55,
      retrieval: { vectorRank: 1, bm25Rank: 1, bm25Coverage: 0.5 },
    },
  ]);
  assert.deepEqual(filtered, []);
});

test("정확 핵심어 절반만 맞고 의미 점수도 애매하면 근거 부족으로 중단한다", () => {
  const fused = fuseGeminiAndBm25(
    [
      {
        id: "weak-catheter",
        text: "신우에서 소변을 배출하기 위해 카테터를 삽입한다.",
        metadata: { section: "배액관 관리" },
        vectorScore: 0.63,
      },
    ],
    [
      {
        id: "weak-catheter",
        text: "신우에서 소변을 배출하기 위해 카테터를 삽입한다.",
        metadata: { section: "배액관 관리" },
        bm25Score: 1.2,
        bm25Coverage: 0.5,
      },
    ],
    { topN: 4, queryText: "비터널형 카테터는 뭐야?" }
  );

  assert.deepEqual(fused, []);
});

test("BM25 보완 결과가 없어도 약한 의미검색 결과는 근거로 승격하지 않는다", () => {
  const fused = fuseGeminiAndBm25(
    [
      {
        id: "weak-vector-only",
        text: "질문과 직접 관련 없는 유사 문서",
        metadata: {},
        vectorScore: 0.63,
      },
    ],
    [],
    { topN: 4, queryText: "비터널형 카테터는 뭐야?" }
  );

  assert.deepEqual(fused, []);
});

test("완전 일치 근거가 있으면 약한 주변 근거로 결과 수를 채우지 않는다", () => {
  const fused = fuseGeminiAndBm25(
    [
      {
        id: "types",
        text: "수혈 종류에는 적혈구 제제와 혈소판 제제가 있다.",
        metadata: { section: "혈액제제 종류" },
        vectorScore: 0.74,
      },
      {
        id: "procedure",
        text: "수혈 전 환자 확인 절차를 시행한다.",
        metadata: { section: "수혈 절차" },
        vectorScore: 0.72,
      },
    ],
    [
      {
        id: "types",
        text: "수혈 종류에는 적혈구 제제와 혈소판 제제가 있다.",
        metadata: { section: "혈액제제 종류" },
        bm25Score: 4,
        bm25Coverage: 1,
      },
      {
        id: "procedure",
        text: "수혈 전 환자 확인 절차를 시행한다.",
        metadata: { section: "수혈 절차" },
        bm25Score: 1,
        bm25Coverage: 0.5,
      },
    ],
    { topN: 4, queryText: "수혈 종류 알려줘" }
  );

  assert.deepEqual(
    fused.map((item) => item.id),
    ["types"]
  );
});

test("같은 본문이면 질문과 맞는 section의 근거를 먼저 둔다", () => {
  const ranked = rankByBm25("수혈 종류 알려줘", [
    {
      id: "procedure",
      text: "수혈 관련 안내",
      metadata: { section: "수혈 절차" },
      corpusPosition: 0,
    },
    {
      id: "types",
      text: "수혈 관련 안내",
      metadata: { section: "혈액제제 종류" },
      corpusPosition: 1,
    },
  ]);

  assert.equal(ranked[0].id, "types");
  assert.ok(ranked[0].sectionCoverage > ranked[1].sectionCoverage);
});

test("의도형 질문은 압도적인 직접 근거가 있으면 주변 근거로 개수를 채우지 않는다", () => {
  const vectorRanked = [
    {
      id: "direct-types",
      text: "혈액제제의 종류를 설명하는 직접 근거",
      metadata: { section: "혈액제제" },
      vectorScore: 0.73,
    },
    {
      id: "consent",
      text: "수혈 동의서에서 혈액 종류를 확인하는 주변 근거",
      metadata: { section: "수혈 동의서" },
      vectorScore: 0.72,
    },
    {
      id: "set-types",
      text: "수혈세트의 종류에 관한 주변 근거",
      metadata: { section: "수혈세트의 종류" },
      vectorScore: 0.69,
    },
    {
      id: "procedure",
      text: "수혈 절차 중 혈액 종류를 확인하는 주변 근거",
      metadata: { section: "수혈 절차" },
      vectorScore: 0.68,
    },
  ];
  const bm25Ranked = [
    { ...vectorRanked[2], bm25Score: 10, bm25Coverage: 1 },
    { ...vectorRanked[3], bm25Score: 8, bm25Coverage: 1 },
    { ...vectorRanked[1], bm25Score: 7, bm25Coverage: 1 },
    { ...vectorRanked[0], bm25Score: 5, bm25Coverage: 1 },
  ];

  const fused = fuseGeminiAndBm25(vectorRanked, bm25Ranked, {
    topN: 4,
    queryText: "수혈 종류 알려줘",
  });

  assert.deepEqual(
    fused.map((item) => item.id),
    ["direct-types"]
  );
});

test("절차형 질문은 직접성이 비슷한 두 근거를 유지해 단계 근거를 보존한다", () => {
  const vectorRanked = [
    {
      id: "procedure-heading",
      text: "진정 절차의 시작 단계",
      metadata: { section: "진정 절차" },
      vectorScore: 0.64,
    },
    {
      id: "procedure-record",
      text: "진정 절차의 기록 단계",
      metadata: { section: "진정 중 기록 방법" },
      vectorScore: 0.63,
    },
    {
      id: "unrelated-procedure",
      text: "수혈 절차",
      metadata: { section: "수혈 절차" },
      vectorScore: 0.48,
    },
  ];
  const bm25Ranked = [
    { ...vectorRanked[1], bm25Score: 12, bm25Coverage: 1 },
    { ...vectorRanked[0], bm25Score: 8, bm25Coverage: 1 },
    { ...vectorRanked[2], bm25Score: 3, bm25Coverage: 0.5 },
  ];

  const fused = fuseGeminiAndBm25(vectorRanked, bm25Ranked, {
    topN: 4,
    queryText: "진정 절차",
  });

  assert.deepEqual(
    fused.map((item) => item.id),
    ["procedure-heading", "procedure-record"]
  );
});

test("절차형 질문은 같은 문서의 연속된 같은 대상 workflow 근거만 보완한다", () => {
  const selected = [
    {
      id: "sedation-before",
      text: "진정 전 평가 확인",
      metadata: {
        document_id: "guide",
        page: 160,
        section: "진정 전 환자평가서 확인 방법",
      },
      retrieval: { fusionScore: 1 },
    },
  ];
  const corpus = [
    {
      id: "purpose",
      text: "진정의 목적",
      metadata: { document_id: "guide", page: 159, section: "진정 목적" },
      corpusPosition: 80,
    },
    { ...selected[0], corpusPosition: 81 },
    {
      id: "sedation-record",
      text: "진정 중 기록 단계",
      metadata: {
        document_id: "guide",
        page: 161,
        section: "진정 중 서면 기록지 출력 방법",
      },
      corpusPosition: 82,
    },
    {
      id: "unrelated",
      text: "진정 대상 규정",
      metadata: { document_id: "guide", page: 162, section: "진정 대상" },
      corpusPosition: 83,
    },
    {
      id: "pediatric",
      text: "소아 진정치료 절차",
      metadata: {
        document_id: "guide",
        page: 166,
        section: "소아 진정치료 절차",
      },
      corpusPosition: 87,
    },
  ];

  const expanded = addProcedureWorkflowCandidates(selected, corpus, {
    queryText: "진정 절차",
    topN: 4,
  });

  assert.deepEqual(
    expanded.map(({ id }) => id),
    ["sedation-before", "sedation-record"]
  );
  assert.equal(
    expanded[1].metadata.schat_procedure_workflow_continuation,
    true
  );
});

test("이미 검색된 연속 절차 근거에도 workflow 표시를 보존한다", () => {
  const corpus = [
    {
      id: "before",
      text: "진정 전 평가 확인",
      metadata: {
        document_id: "guide",
        section: "진정 전 환자평가서 확인 방법",
      },
      corpusPosition: 10,
    },
    {
      id: "record",
      text: "진정 중 기록 단계",
      metadata: {
        document_id: "guide",
        section: "진정 중 기록 방법",
      },
      corpusPosition: 11,
    },
  ];

  const expanded = addProcedureWorkflowCandidates([...corpus], corpus, {
    queryText: "진정 절차",
    topN: 4,
  });

  assert.equal(
    expanded[1].metadata.schat_procedure_workflow_continuation,
    true
  );
});

test("절차 질문만 근거 전달 상한을 6개로 늘리고 다른 질문은 기존 값을 유지한다", () => {
  assert.equal(evidenceResultLimit("진정 절차 알려줘", 4), 6);
  assert.equal(evidenceResultLimit("수혈 종류 알려줘", 4), 4);
});

test("절차 질문은 중간의 목적·대상 항목을 사용하지 않고 뒤의 workflow 근거를 모은다", () => {
  const selected = [
    {
      id: "before",
      text: "진정 전 평가를 확인한다.",
      metadata: {
        document_id: "guide",
        section: "진정 전 평가 확인",
      },
      corpusPosition: 10,
      retrieval: { fusionScore: 1 },
    },
  ];
  const corpus = [
    ...selected,
    {
      id: "purpose",
      text: "진정의 목적",
      metadata: { document_id: "guide", section: "진정 목적" },
      corpusPosition: 11,
    },
    {
      id: "prepare",
      text: "진정 장비를 준비한다.",
      metadata: { document_id: "guide", section: "진정 시행 전 준비" },
      corpusPosition: 12,
    },
    {
      id: "observe",
      text: "진정 중 환자를 관찰한다.",
      metadata: { document_id: "guide", section: "진정 중 관찰" },
      corpusPosition: 13,
    },
    {
      id: "target",
      text: "진정 대상",
      metadata: { document_id: "guide", section: "진정 대상" },
      corpusPosition: 14,
    },
    {
      id: "recovery",
      text: "진정 후 회복 상태를 확인한다.",
      metadata: { document_id: "guide", section: "진정 후 회복" },
      corpusPosition: 15,
    },
    {
      id: "pediatric",
      text: "소아 진정 절차를 시행한다.",
      metadata: { document_id: "guide", section: "소아 진정 절차" },
      corpusPosition: 16,
    },
  ];

  const expanded = addProcedureWorkflowCandidates(selected, corpus, {
    queryText: "진정 절차 알려줘",
    topN: 6,
  });

  assert.deepEqual(
    expanded.map(({ id }) => id),
    ["before", "prepare", "observe", "recovery"]
  );
  assert.equal(
    expanded.slice(1).every(
      ({ metadata }) => metadata.schat_procedure_workflow_continuation === true
    ),
    true
  );
});

test("항목명이 비어 있어도 같은 문서의 뒤쪽 절차 본문은 보완 근거로 유지한다", () => {
  const selected = [
    {
      id: "anchor",
      text: "진정 전 평가를 확인한다.",
      metadata: { document_id: "guide", section: "진정 전 평가 확인" },
      corpusPosition: 20,
      retrieval: { fusionScore: 1 },
    },
  ];
  const corpus = [
    ...selected,
    {
      id: "blank-section-record",
      text: "진정 중 상태를 관찰하고 기록한다.",
      metadata: { document_id: "guide", section: "" },
      corpusPosition: 21,
    },
    {
      id: "pediatric",
      text: "진정 후 회복 상태를 확인한다.",
      metadata: { document_id: "guide", section: "소아 진정치료 절차" },
      corpusPosition: 22,
    },
  ];

  const expanded = addProcedureWorkflowCandidates(selected, corpus, {
    queryText: "진정 절차 알려줘",
    topN: 6,
  });

  assert.deepEqual(
    expanded.map(({ id }) => id),
    ["anchor", "blank-section-record"]
  );
});

test("절차 보완 근거에서 예시·교육용 문장과 기록 예문을 제외한다", () => {
  const selected = [
    {
      id: "anchor",
      text: "진정 전 평가를 확인한다.",
      metadata: { document_id: "guide", section: "진정 전 평가 확인" },
      corpusPosition: 20,
      retrieval: { fusionScore: 1 },
    },
  ];
  const corpus = [
    ...selected,
    {
      id: "observe",
      text: "진정 중 환자를 관찰하고 기록한다.",
      metadata: { document_id: "guide", section: "" },
      corpusPosition: 21,
    },
    {
      id: "record-example",
      text: "진정 간호기록 예시 1 DPAR 기록을 입력한다.",
      metadata: { document_id: "guide", section: "" },
      corpusPosition: 22,
    },
    {
      id: "training-example",
      text: "진정 절차 교육용 예제로 기록한다.",
      metadata: { document_id: "guide", section: "" },
      corpusPosition: 23,
    },
  ];

  const expanded = addProcedureWorkflowCandidates(selected, corpus, {
    queryText: "진정 절차 알려줘",
    topN: 6,
  });

  assert.deepEqual(
    expanded.map(({ id }) => id),
    ["anchor", "observe"]
  );
});

test("넓은 절차 질문에는 더 좁은 별도 처치 방법을 보완 근거로 넣지 않는다", () => {
  const selected = [
    {
      id: "anchor",
      text: "수혈 처방과 동의서를 확인한다.",
      metadata: { document_id: "guide", section: "수혈 절차" },
      corpusPosition: 30,
      retrieval: { fusionScore: 1 },
    },
  ];
  const corpus = [
    ...selected,
    {
      id: "patient-check",
      text: "수혈 직전 환자와 혈액을 확인한다.",
      metadata: { document_id: "guide", section: "수혈 직전 확인" },
      corpusPosition: 31,
    },
    {
      id: "narrow-method",
      text: "PC transfusion 수집 방법과 수혈 세트 처리법을 기록한다.",
      metadata: { document_id: "guide", section: "" },
      corpusPosition: 32,
    },
  ];

  const expanded = addProcedureWorkflowCandidates(selected, corpus, {
    queryText: "수혈 절차 알려줘",
    topN: 6,
  });

  assert.deepEqual(
    expanded.map(({ id }) => id),
    ["anchor", "patient-check"]
  );
});

test("의도 제목이 청크 끝에 있으면 같은 문서의 바로 다음 청크만 연속 근거로 붙인다", () => {
  const selected = [
    {
      id: "heading",
      text: "수혈 간호의 정의\n수혈 요법의 목적\n3. 혈액 제제의 종류",
      metadata: { document_id: "guide", page: 113, section: "수혈 목적" },
      corpusPosition: 10,
      retrieval: { fusionScore: 0.8 },
    },
  ];
  const corpus = [
    ...Array.from({ length: 10 }, (_value, index) => ({
      id: `previous-${index}`,
      text: "이전 근거",
      metadata: { document_id: "guide" },
      corpusPosition: index,
    })),
    selected[0],
    {
      id: "types-table",
      text: "종류\n적혈구 제제\n혈소판 제제\n신선동결혈장",
      metadata: { document_id: "guide", page: 114 },
      corpusPosition: 11,
    },
    {
      id: "later",
      text: "수혈 절차",
      metadata: { document_id: "guide", page: 115 },
      corpusPosition: 12,
    },
  ];

  const expanded = addHeadingContinuationCandidates(selected, corpus, {
    queryText: "수혈 종류 알려줘",
    topN: 4,
  });

  assert.deepEqual(
    expanded.map((item) => item.id),
    ["heading", "types-table"]
  );
  assert.equal(expanded[1].metadata.section, "3. 혈액 제제의 종류");
});

test("벡터 순위가 아닌 원래 corpus 위치로 제목 다음 청크를 찾는다", () => {
  const heading = {
    id: "heading",
    text: "수혈 요법의 목적\n3. 혈액 제제의 종류",
    metadata: { document_id: "guide", page: 113, section: "수혈 목적" },
    corpusPosition: 0,
    vectorScore: 0.9,
  };
  const fused = fuseGeminiAndBm25(
    [heading],
    [
      {
        ...heading,
        corpusPosition: 10,
        bm25Score: 12,
        bm25Coverage: 1,
      },
    ],
    { queryText: "수혈 종류 알려줘" }
  );

  assert.equal(fused[0].corpusPosition, 10);
});

test("Korean question phrasing does not dilute exact clinical evidence", () => {
  const query = "NRS 통증척도는 어떻게 평가해?";
  const ranked = rankByBm25(query, [
    {
      id: "nrs-evidence",
      text: "NRS 통증 평가 도구는 0점부터 10점까지 선택합니다.",
      metadata: {},
    },
  ]);

  assert.deepEqual(queryTokens(query), ["nrs", "통증척도", "평가"]);
  assert.equal(ranked[0].bm25Coverage, 2 / 3);
});

test("an image with a different explicitly selected tool cannot answer an acronym query", () => {
  const result = fuseGeminiAndBm25(
    [
      {
        id: "fprs-selected",
        text: "도구(NRS, FPRS, FLACC) 중 FPRS가 선택된 통증 평가 화면입니다.",
        metadata: { content_type: "image_description" },
        vectorScore: 0.95,
      },
      {
        id: "nrs-screen",
        text: "NRS 통증 평가 도구의 0점부터 10점까지 선택하는 화면입니다.",
        metadata: { content_type: "image_description" },
        vectorScore: 0.8,
      },
      {
        id: "nrs-body",
        text: "NRS 통증 평가 방법을 설명합니다.",
        metadata: {},
        vectorScore: 0.79,
      },
    ],
    [],
    { topN: 3, queryText: "NRS", maxImageResults: 1 }
  );

  assert.equal(result.some(({ id }) => id === "fprs-selected"), false);
  assert.equal(result.some(({ id }) => id === "nrs-screen"), true);
});

test("일반 절차 질문은 CICARE·시나리오 예시를 최초 근거로 사용하지 않는다", () => {
  const vectorRanked = [
    {
      id: "cicare-example",
      text: "수혈 CICARE 시나리오 예시의 수혈 절차",
      metadata: { section: "수혈 절차 교육용 예시" },
      vectorScore: 0.95,
    },
    {
      id: "direct-procedure",
      text: "수혈 절차에서 처방과 동의서를 확인한다.",
      metadata: { section: "수혈 절차" },
      vectorScore: 0.8,
    },
  ];
  const bm25Ranked = [
    { ...vectorRanked[0], bm25Score: 9, bm25Coverage: 1 },
    { ...vectorRanked[1], bm25Score: 8, bm25Coverage: 1 },
  ];

  const result = fuseGeminiAndBm25(vectorRanked, bm25Ranked, {
    topN: 2,
    queryText: "수혈 절차",
  });

  assert.deepEqual(
    result.map(({ id }) => id),
    ["direct-procedure"]
  );
});

test("어떻게 해 절차 질문에서도 CICARE 예시가 근거를 선점하지 않는다", () => {
  const vectorRanked = [
    {
      id: "cicare-example",
      text: "수혈 CICARE 시나리오 예시",
      metadata: { section: "수혈 교육용 예시" },
      vectorScore: 0.95,
    },
    {
      id: "direct-procedure",
      text: "수혈 전 처방과 동의서를 확인한다.",
      metadata: { section: "수혈 절차" },
      vectorScore: 0.8,
    },
  ];
  const bm25Ranked = [
    { ...vectorRanked[0], bm25Score: 9, bm25Coverage: 1 },
    { ...vectorRanked[1], bm25Score: 8, bm25Coverage: 1 },
  ];

  const result = fuseGeminiAndBm25(vectorRanked, bm25Ranked, {
    topN: 2,
    queryText: "수혈은 어떻게 해?",
  });

  assert.deepEqual(
    result.map(({ id }) => id),
    ["direct-procedure"]
  );
});

test("CICARE 예시를 명시적으로 요청하면 해당 근거를 보존한다", () => {
  const example = {
    id: "cicare-example",
    text: "수혈 CICARE 절차 시나리오 예시",
    metadata: { section: "수혈 CICARE 절차 예시" },
    vectorScore: 0.95,
  };

  const result = fuseGeminiAndBm25(
    [example],
    [{ ...example, bm25Score: 9, bm25Coverage: 1 }],
    { topN: 2, queryText: "수혈 CICARE 절차 예시" }
  );

  assert.deepEqual(
    result.map(({ id }) => id),
    ["cicare-example"]
  );
});

test("다른 내부 ID로 중복 등록된 같은 공개 근거는 한 번만 선택한다", () => {
  const duplicateMetadata = {
    title: "2026실무지침서.pdf",
    page: 117,
    section: "수혈 절차",
  };
  const vectorRanked = [
    {
      id: "duplicate-vector",
      text: "수혈 전 처방을 확인한다.",
      metadata: { ...duplicateMetadata, document_id: "upload-a" },
      vectorScore: 0.9,
    },
    {
      id: "unique-step",
      text: "수혈 전 동의서를 확인한다.",
      metadata: { ...duplicateMetadata, page: 118, document_id: "upload-a" },
      vectorScore: 0.88,
    },
  ];
  const bm25Ranked = [
    {
      id: "duplicate-bm25",
      text: " 수혈  전 처방을 확인한다. ",
      metadata: { ...duplicateMetadata, document_id: "upload-b" },
      bm25Score: 9,
      bm25Coverage: 1,
    },
    { ...vectorRanked[1], bm25Score: 8, bm25Coverage: 1 },
  ];

  const result = fuseGeminiAndBm25(vectorRanked, bm25Ranked, {
    topN: 3,
    queryText: "수혈",
  });

  assert.deepEqual(
    result.map(({ id }) => id),
    ["duplicate-vector", "unique-step"]
  );
  assert.equal(result[0].retrieval.vectorRank, 1);
  assert.equal(result[0].retrieval.bm25Rank, 1);
});

test("동일 본문이어도 page 또는 section이 다르면 별도 근거로 보존한다", () => {
  const result = fuseGeminiAndBm25(
    [
      {
        id: "page-117",
        text: "공통 확인 안내",
        metadata: {
          title: "실무지침서.pdf",
          page: 117,
          section: "수혈 절차",
        },
        vectorScore: 0.9,
      },
      {
        id: "page-160",
        text: "공통 확인 안내",
        metadata: {
          title: "실무지침서.pdf",
          page: 160,
          section: "진정 절차",
        },
        vectorScore: 0.88,
      },
    ],
    [],
    { topN: 2, queryText: "확인" }
  );

  assert.deepEqual(
    result.map(({ id }) => id),
    ["page-117", "page-160"]
  );
});

test("BM25 모집단에서도 같은 공개 근거의 중복을 제거한다", () => {
  const metadata = {
    title: "실무지침서.pdf",
    page: 117,
    section: "수혈 절차",
  };
  const result = rankByBm25("수혈", [
    {
      id: "duplicate-a",
      text: "수혈 처방을 확인한다.",
      metadata: { ...metadata, document_id: "upload-a" },
    },
    {
      id: "duplicate-b",
      text: "수혈   처방을 확인한다.",
      metadata: { ...metadata, document_id: "upload-b" },
    },
    {
      id: "unique",
      text: "수혈 동의서를 확인한다.",
      metadata: { ...metadata, page: 118, document_id: "upload-a" },
    },
  ]);

  assert.deepEqual(
    result.map(({ id }) => id),
    ["duplicate-a", "unique"]
  );
});

test("의도형 질문은 주제와 의도가 같은 범위에 있는 직접 근거를 우선한다", () => {
  const wrongScope = {
    id: "wrong-purpose",
    text: "흉막유착술용 Cryo는 수혈기록지에 작성한다.",
    metadata: { section: "검사 목적" },
    vectorScore: 0.95,
  };
  const directScope = {
    id: "direct-purpose",
    text: "수혈의 목적은 부족한 혈액 성분을 보충하는 것이다.",
    metadata: { section: "수혈 목적" },
    vectorScore: 0.9,
  };

  const result = fuseGeminiAndBm25(
    [wrongScope, directScope],
    [
      { ...wrongScope, bm25Score: 10, bm25Coverage: 1 },
      { ...directScope, bm25Score: 8, bm25Coverage: 1 },
    ],
    { topN: 2, queryText: "수혈 목적" }
  );

  assert.deepEqual(
    result.map(({ id }) => id),
    ["direct-purpose"]
  );
});

test("절차 workflow 확장 후에도 중복 공개 근거를 다시 추가하지 않는다", () => {
  const anchor = {
    id: "anchor",
    text: "진정 전 환자를 확인한다.",
    metadata: {
      document_id: "guide",
      title: "실무지침서.pdf",
      page: 160,
      section: "진정 절차",
    },
    corpusPosition: 10,
    retrieval: { fusionScore: 1 },
  };
  const corpus = [
    anchor,
    {
      id: "observe-a",
      text: "진정 중 환자를 관찰하고 기록한다.",
      metadata: {
        document_id: "guide",
        title: "실무지침서.pdf",
        page: 161,
        section: "진정 중 관찰 방법",
      },
      corpusPosition: 11,
    },
    {
      id: "observe-b",
      text: " 진정 중  환자를 관찰하고 기록한다. ",
      metadata: {
        document_id: "guide",
        title: "실무지침서.pdf",
        page: 161,
        section: "진정 중 관찰 방법",
      },
      corpusPosition: 12,
    },
  ];

  const result = addProcedureWorkflowCandidates([anchor], corpus, {
    queryText: "진정 절차",
    topN: 6,
  });

  assert.deepEqual(
    result.map(({ id }) => id),
    ["anchor", "observe-a"]
  );
});

test("일반 절차 질문의 heading 연속 근거로 예시·CICARE가 우회 재유입되지 않는다", () => {
  const heading = {
    id: "heading",
    text: "수혈 개요\n수혈 절차",
    metadata: {
      document_id: "guide",
      title: "실무지침서.pdf",
      page: 117,
      section: "수혈 절차",
    },
    corpusPosition: 10,
    retrieval: { fusionScore: 1 },
  };
  const example = {
    id: "cicare-example",
    text: "수혈 CICARE 시나리오 예시",
    metadata: {
      document_id: "guide",
      title: "실무지침서.pdf",
      page: 118,
      section: "수혈 절차 예시",
    },
    corpusPosition: 11,
  };

  const result = addHeadingContinuationCandidates([heading], [heading, example], {
    queryText: "수혈 절차",
    topN: 4,
  });

  assert.deepEqual(
    result.map(({ id }) => id),
    ["heading"]
  );
});

test("예시·CICARE를 명시하면 heading 다음 연속 근거를 보존한다", () => {
  const heading = {
    id: "heading",
    text: "수혈 CICARE 안내\n수혈 절차 예시",
    metadata: {
      document_id: "guide",
      title: "실무지침서.pdf",
      page: 117,
      section: "수혈 CICARE 절차 예시",
    },
    corpusPosition: 10,
    retrieval: { fusionScore: 1 },
  };
  const example = {
    id: "cicare-example",
    text: "수혈 CICARE 시나리오 예시 본문",
    metadata: {
      document_id: "guide",
      title: "실무지침서.pdf",
      page: 118,
      section: "수혈 CICARE 절차 예시",
    },
    corpusPosition: 11,
  };

  const result = addHeadingContinuationCandidates([heading], [heading, example], {
    queryText: "수혈 CICARE 절차 예시",
    topN: 4,
  });

  assert.deepEqual(
    result.map(({ id }) => id),
    ["heading", "cicare-example"]
  );
});

test("일반 종류 질문은 더 좁은 하위 항목보다 장 단위 근거와 다음 표를 선택한다", () => {
  const chapter = {
    id: "transfusion-chapter",
    text: "11. 수혈간호\n2. 수혈 요법의 목적\n3. 혈액 제제의 종류",
    metadata: {
      document_id: "guide",
      page: 113,
      section: "혈액의 결핍 구성 성분을 보충",
    },
    corpusPosition: 10,
    vectorScore: 0.84,
  };
  const continuation = {
    id: "blood-product-table",
    text: "혈액 제제별 구성과 보관 기준 표",
    metadata: { document_id: "guide", page: 114, section: "" },
    corpusPosition: 11,
  };
  const narrower = {
    id: "transfusion-set-types",
    text: "6. 수혈\n6.1. 수혈세트의 종류",
    metadata: {
      document_id: "guide",
      page: 125,
      section: "수혈세트의 종류",
    },
    corpusPosition: 22,
    vectorScore: 0.96,
  };
  const vectorRanked = [narrower, chapter];
  const bm25Ranked = [
    { ...narrower, bm25Score: 12, bm25Coverage: 1 },
    { ...chapter, bm25Score: 7, bm25Coverage: 1 },
  ];

  const spaced = fuseGeminiAndBm25(vectorRanked, bm25Ranked, {
    topN: 4,
    queryText: "수혈 종류",
  });
  const attached = fuseGeminiAndBm25(vectorRanked, bm25Ranked, {
    topN: 4,
    queryText: "수혈종류",
  });

  assert.deepEqual(
    spaced.map(({ id }) => id),
    ["transfusion-chapter"]
  );
  assert.deepEqual(
    attached.map(({ id }) => id),
    spaced.map(({ id }) => id)
  );
  assert.deepEqual(
    addHeadingContinuationCandidates(
      spaced,
      [chapter, continuation, narrower],
      { queryText: "수혈 종류", topN: 4 }
    ).map(({ id }) => id),
    ["transfusion-chapter", "blood-product-table"]
  );
});

test("일반 목적 질문은 전 검사나 특정 제품 목적보다 장 단위 목적을 선택한다", () => {
  const chapter = {
    id: "transfusion-purpose",
    text: "11. 수혈간호\n2. 수혈 요법의 목적\n부족한 혈액 성분을 보충한다.",
    metadata: { section: "혈액의 결핍 구성 성분을 보충" },
    vectorScore: 0.84,
  };
  const pretest = {
    id: "pretest-purpose",
    text: "2. 수혈 전 검사 확인 및 시행\n2.1. 수혈 전 검사의 목적",
    metadata: { section: "수혈 전 검사의 목적" },
    vectorScore: 0.96,
  };
  const product = {
    id: "product-purpose",
    text: "방사선 조사 혈액제제\n2) 목적\n수혈 시 특정 반응을 예방한다.",
    metadata: { section: "방사선 조사 혈액제제의 목적" },
    vectorScore: 0.93,
  };

  const result = fuseGeminiAndBm25(
    [pretest, product, chapter],
    [
      { ...pretest, bm25Score: 12, bm25Coverage: 1 },
      { ...product, bm25Score: 10, bm25Coverage: 1 },
      { ...chapter, bm25Score: 7, bm25Coverage: 1 },
    ],
    { topN: 4, queryText: "수혈 목적" }
  );

  assert.deepEqual(
    result.map(({ id }) => id),
    ["transfusion-purpose"]
  );
});

test("일반 진정 목적은 다른 장의 진정 언급보다 진정간호 장의 목적을 선택한다", () => {
  const unrelated = {
    id: "procedure-regulation",
    text: "수술 및 시술 규정\n진정 환자 관리 기준과 수술 목적을 설명한다.",
    metadata: { section: "수술 및 시술 규정" },
    vectorScore: 0.96,
  };
  const chapter = {
    id: "sedation-purpose",
    text: "15. 진정간호\n1. 목적\n진정간호의 목적을 설명한다.",
    metadata: { section: "소아 환자의 진정 대상" },
    vectorScore: 0.84,
  };

  const result = fuseGeminiAndBm25(
    [unrelated, chapter],
    [
      { ...unrelated, bm25Score: 12, bm25Coverage: 1 },
      { ...chapter, bm25Score: 7, bm25Coverage: 1 },
    ],
    { topN: 4, queryText: "진정 목적" }
  );

  assert.deepEqual(
    result.map(({ id }) => id),
    ["sedation-purpose"]
  );
});

test("질문에 하위 범위를 명시하면 해당 section 직접 근거를 유지한다", () => {
  const chapter = {
    id: "transfusion-chapter",
    text: "11. 수혈간호\n2. 수혈 요법의 목적\n3. 혈액 제제의 종류",
    metadata: { section: "수혈간호" },
    vectorScore: 0.9,
  };
  const setTypes = {
    id: "transfusion-set-types",
    text: "수혈세트의 종류를 설명한다.",
    metadata: { section: "수혈세트의 종류" },
    vectorScore: 0.88,
  };
  const pretest = {
    id: "pretest-purpose",
    text: "수혈 전 검사의 목적을 설명한다.",
    metadata: { section: "수혈 전 검사의 목적" },
    vectorScore: 0.88,
  };

  assert.deepEqual(
    fuseGeminiAndBm25(
      [chapter, setTypes],
      [
        { ...chapter, bm25Score: 8, bm25Coverage: 2 / 3 },
        { ...setTypes, bm25Score: 10, bm25Coverage: 1 },
      ],
      { topN: 2, queryText: "수혈세트 종류" }
    ).map(({ id }) => id),
    ["transfusion-set-types"]
  );
  assert.deepEqual(
    fuseGeminiAndBm25(
      [chapter, pretest],
      [
        { ...chapter, bm25Score: 8, bm25Coverage: 2 / 3 },
        { ...pretest, bm25Score: 10, bm25Coverage: 1 },
      ],
      { topN: 2, queryText: "수혈 전 검사 목적" }
    ).map(({ id }) => id),
    ["pretest-purpose"]
  );
});

test("장 제목의 수혈은 무수혈·수혈거부 질문의 주제로 오인하지 않는다", () => {
  const chapter = {
    id: "transfusion-chapter",
    text: "11. 수혈간호\n2. 수혈 요법의 목적",
    metadata: { section: "수혈 목적" },
    vectorScore: 0.96,
  };
  const noTransfusion = {
    id: "no-transfusion-purpose",
    text: "무수혈 치료의 목적을 설명한다.",
    metadata: { section: "무수혈 목적" },
    vectorScore: 0.9,
  };
  const refusal = {
    id: "refusal-purpose",
    text: "수혈거부 관리의 목적을 설명한다.",
    metadata: { section: "수혈거부 목적" },
    vectorScore: 0.9,
  };

  assert.deepEqual(
    fuseGeminiAndBm25(
      [chapter, noTransfusion],
      [
        { ...chapter, bm25Score: 10, bm25Coverage: 0.5 },
        { ...noTransfusion, bm25Score: 9, bm25Coverage: 1 },
      ],
      { topN: 2, queryText: "무수혈 목적" }
    ).map(({ id }) => id),
    ["no-transfusion-purpose"]
  );
  assert.deepEqual(
    fuseGeminiAndBm25(
      [chapter, refusal],
      [
        { ...chapter, bm25Score: 10, bm25Coverage: 0.5 },
        { ...refusal, bm25Score: 9, bm25Coverage: 1 },
      ],
      { topN: 2, queryText: "수혈거부 목적" }
    ).map(({ id }) => id),
    ["refusal-purpose"]
  );
});
