import test from "node:test";
import assert from "node:assert/strict";
import {
  findEvidenceHighlights,
  sourceHighlightTexts,
  mergeHighlightTexts,
  highlightAnnotations,
  pdfHighlightUrl,
  inspectPdfEvidence,
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
  assert.equal(result.rects.length, 3);
  assert.deepEqual(result.rects[0], [10, 97.6, 90, 109.6]);
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
test("creates yellow PDF annotations in PDF coordinates and an initial destination", () => {
  const annotations = highlightAnnotations(
    [
      [10, 20, 90, 32],
      [10, 40, 50, 52],
    ],
    3
  );
  assert.equal(annotations[0].pageIndex, 2);
  assert.deepEqual(annotations[0].color, [255, 255, 0]);
  assert.deepEqual(annotations[0].quadPoints, [10, 32, 90, 32, 10, 20, 90, 20]);
  assert.equal(
    pdfHighlightUrl("blob:test", 3, [10, 200]),
    "blob:test#page=3&zoom=100,10,184"
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
