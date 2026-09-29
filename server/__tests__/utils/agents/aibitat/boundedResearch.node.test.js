const test = require("node:test");
const assert = require("node:assert/strict");

const AIbitat = require("../../../../utils/agents/aibitat");
const {
  boundedResearchEnabled,
  forcedEvidenceIsSufficient,
  BOUNDED_EXTRA_SEARCHES,
} = require("../../../../utils/agents/aibitat/utils/hospitalDocumentIntent");
const {
  queryTokens,
  coverageTerms,
  rankByBm25,
  filterWeakHybridTail,
} = require("../../../../utils/vectorDbProviders/chroma/schatBm25");

// ---- request words are not part of the coverage share ----------------------

test("request words are left out of the word-coverage share only", () => {
  const q = "혈액제제 종류를 사진으로 보여줘";
  assert.deepEqual(queryTokens(q), ["혈액제제", "종류", "사진", "보여줘"]);
  assert.deepEqual(coverageTerms(queryTokens(q)), ["혈액제제", "종류"]);
  // a question made only of request words keeps its words
  assert.deepEqual(coverageTerms(queryTokens("사진 보여줘")), [
    "사진",
    "보여줘",
  ]);
  const docs = [
    {
      id: "1",
      text: "가상 혈액제제 종류 표",
      metadata: { page: 1 },
      corpusPosition: 0,
    },
    {
      id: "2",
      text: "가상 혈액제제 보관",
      metadata: { page: 2 },
      corpusPosition: 1,
    },
  ];
  const ranked = rankByBm25(q, docs);
  assert.equal(ranked.find((d) => d.id === "1").bm25Coverage, 1);
  assert.equal(ranked.find((d) => d.id === "2").bm25Coverage, 0.5);
  for (const word of [
    "그림",
    "이미지",
    "보여주세요",
    "알려줘",
    "자세히",
    "해야해",
    "할까",
  ])
    assert.deepEqual(coverageTerms(["수혈", word]), ["수혈"], word);
});

test("an abbreviation in the question keeps chunks that contain it", () => {
  const candidate = (id, text, vectorScore) => ({
    id,
    text,
    vectorScore,
    retrieval: { bm25Coverage: 0.5, vectorScore },
  });
  const ranked = [
    candidate("a", "가상 PTNB 검사 후 관찰 사항", 0.63),
    candidate("b", "가상 경피적 시술 설명", 0.62),
  ];
  const kept = filterWeakHybridTail(ranked, {
    queryText: "PTNB 후 간호 알려줘",
  });
  assert.deepEqual(
    kept.map((c) => c.id),
    ["a"]
  );
  // an abbreviation that no chunk contains keeps nothing new
  assert.deepEqual(
    filterWeakHybridTail(ranked, { queryText: "TAVI 후 간호 알려줘" }),
    []
  );
  // partial word matches do not count (PTNBX is not PTNB)
  assert.deepEqual(
    filterWeakHybridTail([candidate("c", "가상 PTNBX 설명", 0.6)], {
      queryText: "PTNB 후 간호",
    }),
    []
  );
});

// ---- option C -------------------------------------------------------------

test("option C is off by default and judges forced evidence simply", () => {
  assert.equal(boundedResearchEnabled({}), false);
  assert.equal(
    boundedResearchEnabled({ SCHAT_AGENT_RESEARCH_MODE: "bounded" }),
    true
  );
  const src = (page, excerpt) => ({ documentName: "가상.pdf", page, excerpt });
  assert.equal(forcedEvidenceIsSufficient([]), false);
  // 2 chunks on one page: not sufficient
  assert.equal(forcedEvidenceIsSufficient([src(1, "가"), src(1, "나")]), false);
  // 3 chunks on one page: sufficient (that page is the dedicated section)
  assert.equal(
    forcedEvidenceIsSufficient([src(1, "가"), src(1, "나"), src(1, "다")]),
    true
  );
  // a decorative logo image is not counted as evidence
  assert.equal(
    forcedEvidenceIsSufficient([
      src(1, "가"),
      src(1, "나"),
      src(2, "파란색 SCH 영문 로고"),
    ]),
    false
  );
  // 3 chunks over 2 pages: sufficient
  assert.equal(
    forcedEvidenceIsSufficient([src(1, "가"), src(1, "나"), src(2, "다")]),
    true
  );
  assert.equal(BOUNDED_EXTRA_SEARCHES, 2);
});

function boundedAgent({ answerAfterLimit }) {
  const aibitat = new AIbitat({ provider: "openai", model: "virtual" });
  const calls = { stream: [], searches: 0 };
  aibitat.providerInstance = {
    model: "virtual",
    isModelLoaded: async () => true,
    resetCumulativeUsage() {},
    getCumulativeUsage: () => ({}),
    async stream(messages, functions) {
      calls.stream.push({ messages, functions });
      const afterLimit = messages.some(
        (m) =>
          m.role === "user" && /추가 검색은 더 할 수 없습니다/.test(m.content)
      );
      if (afterLimit && answerAfterLimit)
        return {
          textResponse: "가상 최종 답변",
          functionCall: null,
          uuid: "u1",
        };
      // the model keeps asking for another search, even without tools
      return {
        textResponse: "",
        functionCall: {
          name: "rag-memory",
          arguments: { action: "search", content: "가상" },
        },
        uuid: "u0",
      };
    },
  };
  aibitat.functions.set("rag-memory", {
    name: "rag-memory",
    handler: async () => {
      calls.searches += 1;
      return "가상 검색 결과";
    },
  });
  aibitat._schatExtraSearchLimit = 2;
  aibitat._schatExtraSearches = 0;
  return { aibitat, calls };
}

test("option C never executes a search beyond the limit", async () => {
  const { aibitat, calls } = boundedAgent({ answerAfterLimit: true });
  const answer = await aibitat.handleAsyncExecution(
    [{ role: "user", content: "가상 질문" }],
    [{ name: "rag-memory" }],
    "agent",
    0
  );
  assert.equal(calls.searches, 2);
  assert.equal(answer, "가상 최종 답변");
  const last = calls.stream.at(-1);
  // the final call has no tools and no tool-call history
  assert.deepEqual(last.functions, []);
  assert.equal(
    last.messages.some((m) => m.role === "function"),
    false
  );
  assert.ok(
    last.messages.some((m) => /\[병원 문서 검색 결과\]/.test(m.content))
  );
});

test("option C gives a safe answer if the model still insists on searching", async () => {
  const { aibitat, calls } = boundedAgent({ answerAfterLimit: false });
  const answer = await aibitat.handleAsyncExecution(
    [{ role: "user", content: "가상 질문" }],
    [{ name: "rag-memory" }],
    "agent",
    0
  );
  assert.equal(calls.searches, 2);
  // no evidence was found, so the safe "not found" answer is used
  assert.equal(answer, "등록된 문서에서 확인되지 않습니다.");
  // 3 calls with tools (2 searches executed) + 2 tool-free attempts
  assert.equal(calls.stream.length, 5);
  // the second tool-free attempt is one compact user message
  const compact = calls.stream.at(-1).messages;
  assert.deepEqual(
    compact.map((m) => m.role),
    ["user"]
  );
  assert.match(compact[0].content, /가상 검색 결과/);
  assert.match(compact[0].content, /추가 검색은 더 할 수 없습니다/);
});

test("option C points to the evidence instead of 'not found' when evidence exists", async () => {
  const { aibitat, calls } = boundedAgent({ answerAfterLimit: false });
  aibitat.addRagMemorySources([
    { id: "v1", document_name: "가상.pdf", page: 3, text: "가상 근거" },
  ]);
  const answer = await aibitat.handleAsyncExecution(
    [{ role: "user", content: "가상 질문" }],
    [{ name: "rag-memory" }],
    "agent",
    0
  );
  assert.equal(calls.searches, 2);
  assert.equal(
    answer,
    "등록된 문서에서 관련 근거를 찾았습니다. 아래 출처에서 원문 내용을 확인해 주세요."
  );
});

test("option C final instruction asks to answer from related evidence", () => {
  const {
    BOUNDED_FINAL_INSTRUCTION,
  } = require("../../../../utils/agents/aibitat/utils/hospitalDocumentIntent");
  assert.match(BOUNDED_FINAL_INSTRUCTION, /관련된 내용이 일부라도 있으면/);
  assert.match(BOUNDED_FINAL_INSTRUCTION, /하나도 없을 때만/);
  assert.match(BOUNDED_FINAL_INSTRUCTION, /만들지 마세요/);
});

test("without option C the existing behaviour is unchanged", async () => {
  const { aibitat, calls } = boundedAgent({ answerAfterLimit: true });
  aibitat._schatExtraSearchLimit = null;
  aibitat.maxToolCalls = 3;
  let n = 0;
  aibitat.providerInstance.stream = async () => {
    n += 1;
    return n <= 3
      ? {
          functionCall: { name: "rag-memory", arguments: {} },
          textResponse: "",
          uuid: "x",
        }
      : { functionCall: null, textResponse: "끝", uuid: "y" };
  };
  const answer = await aibitat.handleAsyncExecution(
    [{ role: "user", content: "가상" }],
    [{ name: "rag-memory" }],
    "agent",
    0
  );
  assert.equal(answer, "끝");
  assert.equal(calls.searches, 3);
});
