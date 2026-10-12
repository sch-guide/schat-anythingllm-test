import test from "node:test";
import assert from "node:assert/strict";
import {
  findEvidenceHighlights,
  sourceHighlightTexts,
  mergeHighlightTexts,
  highlightAnnotations,
  pdfHighlightUrl,
  inspectPdfEvidence,
  answerHighlightTexts,
} from "./pdfEvidenceHighlight.js";

const item = (str, x = 10, y = 100, width = 80) => ({
  str,
  transform: [12, 0, 0, 12, x, y],
  width,
  height: 12,
  fontName: "f1",
  dir: "ltr",
});
const content = (items) => ({
  items,
  styles: { f1: { ascent: 0.8, descent: -0.2 } },
});

test("matches the entire evidence across spaces and line breaks and returns every separate region", () => {
  const result = findEvidenceHighlights(
    content([item("Alpha beta"), item("Gamma", 10, 80), item("Other", 10, 60)]),
    ["Alpha\nbeta Gamma", "Other"]
  );
  assert.equal(result.matched, true);
  assert.equal(result.rects.length, 2);
  assert.deepEqual(result.rects[0], [10, 77.6, 90, 109.6]);
});
test("table text preserves punctuation and order; changed cells never match", () => {
  const table = content([
    item("Drug", 10),
    item("10 mg", 100),
    item("IV", 200),
  ]);
  assert.equal(
    findEvidenceHighlights(table, ["Drug\t10 mg\nIV"]).matched,
    true
  );
  assert.equal(
    findEvidenceHighlights(table, ["Drug 100 mg IV"]).matched,
    false
  );
  assert.equal(findEvidenceHighlights(table, ["IV 10 mg Drug"]).matched, false);
});
test("any missing or ambiguous evidence makes the entire display fall back without partial highlights", () => {
  const page = content([
    item("Alpha"),
    item("Alpha", 10, 80),
    item("Other", 10, 60),
  ]);
  for (const texts of [["Alpha"], ["Other", "missing"], [], [""], ["alpha"]]) {
    assert.deepEqual(findEvidenceHighlights(page, texts), {
      matched: false,
      rects: [],
    });
  }
});
test("does not estimate partial glyph positions or unsupported text geometry", () => {
  assert.equal(
    findEvidenceHighlights(content([item("Alpha beta")]), ["beta"]).matched,
    false
  );
  assert.equal(
    findEvidenceHighlights(
      content([{ ...item("Alpha"), transform: [0, 12, -12, 0, 10, 100] }]),
      ["Alpha"]
    ).matched,
    false
  );
  assert.equal(findEvidenceHighlights(content([]), ["Alpha"]).matched, false);
});
test("keeps all original chunks with metadata removed; never replaces full chunk with shortened excerpt", () => {
  assert.deepEqual(
    sourceHighlightTexts({
      text: "<document_metadata>header</document_metadata>\nFull chunk",
      excerpt: "Full",
    }),
    ["Full chunk"]
  );
  assert.deepEqual(
    sourceHighlightTexts({
      highlightTexts: ["First", "Second", "First"],
      excerpt: "First",
    }),
    ["First", "Second"]
  );
});
test("creates pale green borderless PDF highlights in PDF coordinates and an initial destination", () => {
  const annotations = highlightAnnotations(
    [
      [10, 20, 90, 32],
      [10, 40, 50, 52],
    ],
    3
  );
  assert.equal(annotations[0].pageIndex, 2);
  assert.deepEqual(
    annotations[0].color.map((channel) =>
      Math.round(
        255 * (1 - annotations[0].opacity) + channel * annotations[0].opacity
      )
    ),
    [230, 247, 200]
  );
  assert.equal(annotations[0].annotationType, 9);
  assert.equal(annotations[0].paths, undefined);
  assert.deepEqual(annotations[0].quadPoints, [10, 32, 90, 32, 10, 20, 90, 20]);
  assert.equal(
    pdfHighlightUrl("blob:test", 3, [10, 200]),
    "blob:test#page=3&view=FitH,184"
  );
  assert.equal(
    pdfHighlightUrl("blob:test", 3, [10, 200], 150),
    "blob:test#page=3&zoom=150,0,276"
  );
});
test("merging citations retains both complete chunks even when the display selects one representative", () => {
  assert.deepEqual(
    mergeHighlightTexts(
      { text: "First chunk", excerpt: "First" },
      { text: "Second chunk" }
    ),
    ["First chunk", "Second chunk"]
  );
});
test("invalid pages and PDF text extraction errors preserve the document without misleading highlights", async () => {
  const pdf = {
    numPages: 1,
    getPage() {
      throw new Error("unreadable text");
    },
  };
  for (const page of [1, 0, 2, "invalid"]) {
    assert.deepEqual(await inspectPdfEvidence(pdf, page, ["Alpha"]), {
      matched: false,
      rects: [],
      page: 1,
    });
  }
});

test("answer highlighting selects only verbatim evidence sentences, never the full retrieved page", () => {
  const source = {
    text: "Document heading\nPrepare the equipment.\nInject slowly into the tissue.\nObserve the patient after injection.",
  };
  assert.deepEqual(
    answerHighlightTexts(
      source,
      "**Instructions**\n- Inject slowly into the tissue."
    ),
    ["Inject slowly into the tissue."]
  );
  assert.deepEqual(
    answerHighlightTexts(source, "Use a slow injection technique."),
    []
  );
  assert.deepEqual(answerHighlightTexts(source, ""), []);
  assert.deepEqual(
    answerHighlightTexts(
      source,
      "Prepare the equipment. Observe the patient after injection."
    ),
    ["Prepare the equipment.", "Observe the patient after injection."]
  );
});

test("adjacent exact Korean sentences form one region while unrelated lines break regions", () => {
  const first = "테스트 문서의 첫 번째 확인 항목을 표시합니다.";
  const second = "테스트 문서의 두 번째 확인 항목을 표시합니다.";
  const other = "답변에 사용하지 않은 다른 항목은 표시하지 않습니다.";
  assert.deepEqual(
    answerHighlightTexts(
      { text: first + "\n" + second + "\n" + other },
      first + " " + second
    ),
    [first + "\n" + second]
  );
  assert.deepEqual(
    answerHighlightTexts(
      { text: first + "\n" + other + "\n" + second },
      first + " " + second
    ),
    [first, second]
  );
});

test("verified source quotes survive paraphrasing and missing quotes never select the whole page", () => {
  const source = {
    text: "검사용 도구를 준비한다. 검사용 표시를 확인한다. 다른 항목은 제외한다.",
    evidenceQuotes: ["검사용 표시를 확인한다."],
  };
  assert.deepEqual(
    answerHighlightTexts(source, "검사를 마친 뒤 표시 상태를 살펴보세요."),
    source.evidenceQuotes
  );
  assert.deepEqual(
    answerHighlightTexts({ ...source, evidenceQuotes: [] }, source.text),
    []
  );
});

test("paint rectangles follow individual evidence lines and table cells without changing navigation bounds", () => {
  const page = content([
    item("First evidence", 10, 100, 80),
    item("Unrelated middle", 10, 80, 100),
    item("Last evidence", 10, 60, 60),
  ]);
  const result = findEvidenceHighlights(page, [
    "First evidence",
    "Last evidence",
  ]);
  assert.equal(result.matched, true);
  assert.deepEqual(result.paintRects, [
    [10, 97.6, 90, 109.6],
    [10, 57.6, 70, 69.6],
  ]);
  const table = findEvidenceHighlights(
    content([item("Left cell", 10, 100, 40), item("Right cell", 200, 100, 50)]),
    ["Left cell Right cell"]
  );
  assert.deepEqual(table.rects, [[10, 97.6, 250, 109.6]]);
  assert.deepEqual(table.paintRects, [
    [10, 97.6, 50, 109.6],
    [200, 97.6, 250, 109.6],
  ]);
});

test("transfusion example paints only recorded evidence and preserves source metadata", () => {
  const source = {
    pdfRef: "synthetic-ref",
    page: 13,
    bbox: [1, 2, 3, 4],
    text: "수혈 직전 환자확인\n수혈 시 주의사항\n환자 상태 확인 및 간호기록\nRBC 수혈 기록 입력\n관계없는 다음 설명",
    evidenceQuotes: [
      "수혈 시 주의사항",
      "환자 상태 확인 및 간호기록",
      "RBC 수혈 기록 입력",
    ],
  };
  const before = structuredClone(source);
  const page = content(
    source.text
      .split("\n")
      .map((line, index) => item(line, 10, 200 - index * 20, 100))
  );
  const result = findEvidenceHighlights(
    page,
    answerHighlightTexts(source, "검사에 사용할 합성 답변")
  );
  assert.equal(result.matched, true);
  assert.equal(result.paintRects.length, 3);
  assert.deepEqual(
    result.paintRects.map((rect) => rect[1]),
    [177.6, 157.6, 137.6]
  );
  assert.deepEqual(source, before);
  assert.deepEqual(
    answerHighlightTexts({ ...source, evidenceQuotes: [] }, source.text),
    []
  );
});

test("only practical guide documents receive highlight text without mutating evidence", async () => {
  const { documentEvidenceTexts } = await import("./pdfEvidenceHighlight.js");
  const texts = ["verified evidence"];
  assert.equal(
    documentEvidenceTexts("2026실무지침서 (26.7).pdf", texts),
    texts
  );
  assert.equal(documentEvidenceTexts("간호 실무 지침.pdf", texts), texts);
  for (const name of ["검사 및 시술(260326).pdf", "수술.pdf", "", undefined]) {
    assert.deepEqual(documentEvidenceTexts(name, texts), []);
  }
  assert.deepEqual(texts, ["verified evidence"]);
});
