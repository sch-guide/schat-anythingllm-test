const test = require("node:test");
const assert = require("node:assert/strict");
const {
  rankByBm25,
  filterWeakHybridTail,
  matchedSubjectTerms,
} = require("../../../../utils/vectorDbProviders/chroma/schatBm25");

const doc = (id, text) => ({
  id,
  text,
  metadata: { page: 1 },
  corpusPosition: 0,
});

test("spaced questions find space-less guideline text", () => {
  const docs = [
    doc("a", "HD투석관삽입술(HDCatheterInsertion):병동"),
    doc("b", "수혈 절차"),
  ];
  const ranked = rankByBm25("HD 투석관 삽입술", docs);
  assert.equal(ranked[0].id, "a");
  assert.equal(ranked[0].bm25Coverage, 1);
});

test("space-less questions find spaced guideline text", () => {
  const docs = [doc("a", "투석관 삽입술 준비 사항"), doc("b", "수혈 절차")];
  const ranked = rankByBm25("투석관삽입술 준비", docs);
  assert.equal(ranked[0].id, "a");
  assert.equal(ranked[0].bm25Coverage, 1);
});

test("exact words keep their score; one-letter words are never matched inside words", () => {
  const docs = [doc("a", "수혈 절차 확인"), doc("b", "전혈 보관")];
  const before = rankByBm25("수혈 절차", docs);
  assert.equal(before.length, 1);
  assert.equal(before[0].id, "a");
  // "전" alone must not match inside "전혈"
  assert.equal(rankByBm25("전", docs).length, 0);
});

test("the last filter and picture subjects use the same spacing rule", () => {
  assert.equal(
    matchedSubjectTerms("위내시경GFS검사전준비", ["위내시경", "준비"]),
    2
  );
  const kept = filterWeakHybridTail(
    [
      {
        id: "a",
        text: "흉수천자Thoracentesis검사후관찰사항",
        retrieval: {
          bm25Coverage: rankByBm25("흉수천자 후 관찰", [
            doc("a", "흉수천자Thoracentesis검사후관찰사항"),
          ])[0].bm25Coverage,
          vectorScore: 0.6,
        },
        vectorScore: 0.6,
      },
    ],
    { queryText: "흉수천자 후 관찰" }
  );
  assert.equal(kept.length, 1);
});
