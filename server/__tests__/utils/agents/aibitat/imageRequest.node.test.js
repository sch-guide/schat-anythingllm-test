const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isImageRequest,
  subjectTerms,
  queryTokens,
  filterWeakHybridTail,
  addSamePageImageCandidates,
} = require("../../../../utils/vectorDbProviders/chroma/schatBm25");
const {
  attachRelatedImageSources,
  imageRequestContextSources,
} = require("../../../../utils/agents/aibitat/plugins/memory");
const {
  buildPublicRagSource,
} = require("../../../../utils/agents/aibitat/utils/ragSources");

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const KEY_C = "c".repeat(64);

test("only picture questions are image requests; facet words are not subjects", () => {
  assert.equal(isImageRequest("혈액제제 종류를 사진으로 보여줘"), true);
  assert.equal(isImageRequest("수혈 세트 그림 보여줘"), true);
  assert.equal(isImageRequest("수혈 종류"), false);
  assert.equal(isImageRequest("영상검사 전 준비"), false);
  assert.deepEqual(
    subjectTerms(queryTokens("혈액제제 종류를 사진으로 보여줘")),
    ["혈액제제"]
  );
  assert.deepEqual(subjectTerms(queryTokens("수혈 세트 그림 보여줘")), [
    "수혈",
    "세트",
  ]);
});

function candidate(id, text, vectorScore, bm25Coverage = 0.5, extra = {}) {
  return {
    id,
    text,
    vectorScore,
    metadata: { page: 1, ...extra },
    retrieval: { bm25Coverage, vectorScore },
  };
}

test("picture question keeps a top semantic chunk holding every subject word", () => {
  const ranked = [
    candidate("diagram", "가상 혈액제제 계통도 그림", 0.69),
    candidate("table", "가상 종류 표 적혈구 제제", 0.68),
    candidate("far", "가상 혈액제제 폐기 절차", 0.62),
  ];
  const kept = filterWeakHybridTail(ranked, {
    queryText: "혈액제제 종류를 사진으로 보여줘",
  });
  // "table" misses the subject word, "far" is not near the best score
  assert.deepEqual(
    kept.map((c) => c.id),
    ["diagram"]
  );
  // the same chunks for a non-picture question: old rule, nothing passes
  assert.deepEqual(
    filterWeakHybridTail(ranked, { queryText: "혈액제제 종류 알려줘" }),
    []
  );
  // a subject that is not in the chunk never passes (out-of-scope questions)
  assert.deepEqual(
    filterWeakHybridTail(
      [candidate("x", "가상 수술 후 보호구 착용 그림", 0.69)],
      { queryText: "라식 수술 후 안대 착용 그림 보여줘" }
    ),
    []
  );
});

test("same-page pictures need the most specific subject word", () => {
  const evidence = [
    candidate("t125", "가상 수혈 세트 설명", 0.7, 1, {
      document_id: "doc",
      page: 125,
    }),
  ];
  const images = [
    candidate("set-photo", "가상 세트 사진", 0.66, 0.5, {
      document_id: "doc",
      page: 125,
      content_type: "image_description",
      image_key: KEY_A,
    }),
    candidate("common-word", "가상 수혈 설명 그림", 0.66, 0.5, {
      document_id: "doc",
      page: 125,
      content_type: "image_description",
      image_key: KEY_B,
    }),
    candidate("other-page", "가상 세트 사진", 0.66, 0.5, {
      document_id: "doc",
      page: 300,
      content_type: "image_description",
      image_key: KEY_C,
    }),
  ];
  // corpus: "수혈" is common (3 chunks), "세트" is rare (1 chunk)
  const corpus = [
    { id: "1", text: "수혈 세트", metadata: {} },
    { id: "2", text: "수혈 절차", metadata: {} },
    { id: "3", text: "수혈 부작용", metadata: {} },
  ];
  const result = addSamePageImageCandidates([], {
    evidence,
    candidates: images,
    corpus,
    queryText: "수혈 세트 그림 보여줘",
  });
  assert.deepEqual(
    result.map((image) => image.id),
    ["set-photo"]
  );
});

function source(page, extra = {}) {
  return {
    id: `s${page}`,
    document_id: "doc",
    document_name: "guide.pdf",
    page,
    text: `가상 근거 p.${page}`,
    ...extra,
  };
}

function image(id, page, text, key) {
  return {
    id,
    document_id: "doc",
    document_name: "guide.pdf",
    page,
    content_type: "image_description",
    image_key: key,
    text,
  };
}

test("picture question shows a nearby picture as its own source with its own page", () => {
  const question = "수혈 세트 그림 보여줘";
  const linked = attachRelatedImageSources(
    [source(116)],
    [
      image("near", 115, "가상 수혈 세트 제품 사진", KEY_A),
      image("far", 300, "가상 수혈 세트 사진", KEY_B),
      image("one-word", 117, "가상 세트 사진", KEY_C),
    ],
    question
  );
  assert.equal(linked.length, 2);
  const shown = buildPublicRagSource(linked[1], { question });
  assert.equal(shown.page, 115);
  assert.deepEqual(
    shown.relatedImages.map((i) => [i.imageKey, i.page]),
    [[KEY_A, 115]]
  );
  // the model is told which picture exists
  const context = imageRequestContextSources([source(116)], linked, question);
  assert.equal(context.length, 3);
  assert.match(context[1].text, /지침서 그림 설명, p\.115/);
  // the model is told that the picture is shown under the answer
  assert.match(
    context[2].text,
    /답변 아래 출처에 원본 사진으로 함께 표시됩니다/
  );
});

test("non-picture questions keep the old same-page-only rule and context", () => {
  const question = "수혈 세트 알려줘";
  const sources = [source(116)];
  const linked = attachRelatedImageSources(
    sources,
    [image("near", 115, "가상 수혈 세트 제품 사진", KEY_A)],
    question
  );
  assert.equal(linked.length, 1);
  assert.equal(linked[0].image_key, undefined);
  assert.equal(imageRequestContextSources(sources, linked, question), sources);
});
