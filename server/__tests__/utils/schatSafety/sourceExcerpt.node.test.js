const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeDisplaySources } = require("../../../utils/schatSafety/finalize");

test("verified exact_text becomes a sanitized public source excerpt", () => {
  const [source] = normalizeDisplaySources([
    {
      source_unit_id: "su001",
      document_name: "C:\\internal\\2026실무지침서.pdf",
      page: 117,
      section: "수혈 절차",
      exact_text: [
        "<document_metadata>internal/path.pdf</document_metadata>",
        "혈액의 수령 즉시 혈액제제 손상 유무, 이상 유무를 육안으로 확인한다.",
        "<svg><path id=\"private\" /></svg>",
      ].join("\n"),
      metadata: { internal_path: "C:\\private\\document.pdf" },
    },
  ]);

  assert.deepEqual(source, {
    title: "2026실무지침서.pdf · p.117 · 수혈 절차",
    documentName: "2026실무지침서.pdf",
    document_name: "2026실무지침서.pdf",
    page: 117,
    section: "수혈 절차",
    excerpt:
      "혈액의 수령 즉시 혈액제제 손상 유무, 이상 유무를 육안으로 확인한다.",
    text: "혈액의 수령 즉시 혈액제제 손상 유무, 이상 유무를 육안으로 확인한다.",
    chunkSource: "",
  });
  assert.doesNotMatch(
    JSON.stringify(source),
    /su001|metadata|internal_path|private|<svg|document_metadata/i
  );
});

test("long excerpts are cut only after a complete sentence", () => {
  const sentence = "검증된 근거 문장을 그대로 표시합니다. ";
  const [source] = normalizeDisplaySources([
    { document_name: "지침.pdf", exact_text: sentence.repeat(100) },
  ]);

  assert.ok(source.excerpt.length <= 1250);
  assert.match(source.excerpt, /다\. …$/);
  assert.equal(source.text, source.excerpt);
});

test("sources without an excerpt retain the metadata-only shape", () => {
  const [source] = normalizeDisplaySources([
    { document_name: "과거지침.pdf", page: "12", section: "기존 항목" },
  ]);

  assert.equal(source.documentName, "과거지침.pdf");
  assert.equal(source.excerpt, "");
  assert.equal(source.text, "");
});
