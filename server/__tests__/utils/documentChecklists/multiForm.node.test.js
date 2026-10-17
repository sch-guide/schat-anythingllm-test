// 2026-10-15: 수술 문서의 한 쪽에 양식이 두 개(왼쪽·오른쪽) 있고, 한쪽은 "수 술 전"
// 표시에 일반(검사·시술) 양식 줄, 다른 쪽은 "검 사 전" 양식인 경우 한 체크리스트로
// 합쳐지거나 빠졌다. 가상 글자만 쓴다(병원 원문 없음).
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractProcedureChecklist,
  extractProcedureChecklists,
  extractProcedureChecklistRegions,
} = require("../../../utils/documentChecklists/procedureExtractor");
const {
  processDocumentChecklists,
} = require("../../../utils/documentChecklists/processDocuments");

function words(y, x, list, h = 10) {
  const items = [];
  let cursor = x;
  for (const str of list) {
    const w = [...str].length * 9.4;
    items.push({ str, x: cursor, y, w, h });
    cursor += w + 4.5;
  }
  return items;
}
function marker(x, y, chars) {
  return [...chars].map((str, i) => ({ str, x, y: y - i * 16, w: 9.4, h: 10 }));
}

/** 일반 양식 한 개. dx만큼 오른쪽으로 옮기고, 수술 문서식 낱말을 쓸 수 있다. */
function form({ dx = 0, title = "가상시술술", surgeryWords = false, withoutPrepare = false } = {}) {
  const cell = 152 + dx;
  const before = surgeryWords ? "수술전" : "검사전";
  const after = surgeryWords ? "수술후" : "검사후";
  return [
    ...words(752, 239 + dx, [title, "ABCD"], 15),
    ...marker(68.7 + dx, 580, before),
    ...words(692, 100 + dx, [surgeryWords ? "수술목적" : "검사목적"]),
    ...words(692, cell, ["가상", "목적"]),
    ...words(641, 104.7 + dx, ["동의서"]),
    ...words(641, cell, ["①", "가상", "동의서"]),
    ...words(590, 100 + dx, ["금식여부"]),
    ...words(590, cell, ["MN", "NPO"]),
    ...words(590, 323 + dx, ["IV", "line"]),
    ...words(590, 377 + dx, ["20G"]),
    ...words(533, 90.3 + dx, ["검사", "전", "준비"]),
    ...words(533, cell, ["가상", "준비물"]),
    ...(withoutPrepare ? [] : words(478, 101 + dx, ["Prepare"])),
    ...words(478, cell, ["가상", "물품"]),
    ...words(441, 98 + dx, [surgeryWords ? "수술장소" : "검사장소", "/"]),
    ...words(425, 100 + dx, ["이동수단"]),
    ...words(433, cell, ["가상실", "/", "S-car"]),
    ...marker(68.7 + dx, 286, after),
    ...words(362, 109 + dx, ["식이"]),
    ...words(362, cell, ["-"]),
    ...words(301, 109 + dx, ["자세"]),
    ...words(301, cell, ["가상", "자세"]),
    ...words(248, 99 + dx, ["X-ray", "및"]),
    ...words(232, 110 + dx, ["Lab"]),
    ...words(240, cell, ["가상", "촬영"]),
    ...words(163, 100 + dx, ["관찰사항"]),
    ...words(171, cell, ["가상", "관찰"]),
  ];
}

function page(items, width = 595) {
  return {
    layout: { width, height: 842, items },
    text: items.map((item) => item.str).join("\n"),
  };
}

const input = ({ layout, text }) => ({
  documentId: "doc-1",
  filename: "가상 수술.pdf",
  page: 3,
  text,
  layout,
});

test("수술 문서식 낱말(수 술 전·수술목적·수술장소)로 적힌 일반 양식도 읽는다", () => {
  const checklist = extractProcedureChecklist(input(page(form({ surgeryWords: true }))));
  assert.equal(checklist.status, "active");
  assert.equal(checklist.templateKind, "procedure");
  assert.deepEqual(
    checklist.sections.map((section) => section.title),
    ["수술 전", "수술 후"]
  );
  assert.equal(checklist.sections[0].items[0].label, "수술목적");
  assert.equal(checklist.sections[0].items.at(-1).label, "수술장소/이동수단");
});

test("한 쪽의 왼쪽 수술식 양식과 오른쪽 검사 양식은 따로 두 체크리스트가 된다", () => {
  const items = [
    ...form({ title: "왼쪽수술", surgeryWords: true }),
    ...form({ dx: 420, title: "오른쪽검사" }),
  ];
  const checklists = extractProcedureChecklists(input(page(items, 841)));
  assert.deepEqual(
    checklists.map((checklist) => [checklist.title, checklist.status]),
    [
      ["왼쪽수술 ABCD", "active"],
      ["오른쪽검사 ABCD", "active"],
    ]
  );
  assert.notEqual(checklists[0].id, checklists[1].id);
  // 한쪽 양식의 본문 글자가 다른 체크리스트 이름으로 들어가지 않는다.
  for (const checklist of checklists)
    assert.ok(checklist.aliases.every((alias) => !/Prepare|S-car|NPO/.test(alias)));
});

test("한 쪽의 양식 중 일부를 못 읽으면 빠뜨리지 않고 개수를 알린다", async () => {
  const two = page(
    [...form({ title: "왼쪽수술" }), ...form({ dx: 420, title: "오른쪽검사", withoutPrepare: true })],
    841
  );
  const regions = extractProcedureChecklistRegions(input(two));
  assert.equal(regions.checklists.length, 1);
  assert.equal(regions.missedRegions, 1);

  const saved = [];
  const result = await processDocumentChecklists([{ location: "a.json" }], {
    loadDocument: async () => ({
      document_id: "doc-1",
      title: "가상 수술.pdf",
      page: 3,
      pageContent: two.text,
    }),
    loadLayouts: async (documentId, pages) => new Map(pages.map((number) => [number, two.layout])),
    repository: {
      saveAutoChecklist(checklist) {
        saved.push(checklist);
        return { created: true, checklist };
      },
    },
    logger: null,
  });
  assert.equal(saved.length, 1);
  assert.deepEqual(result.failures, [
    { document: "가상 수술.pdf", page: 3, title: null, reason: "region-not-recognised" },
  ]);
});
