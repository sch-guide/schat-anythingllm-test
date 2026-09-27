const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractProcedureChecklist,
  isStandardProcedurePage,
  aliasesFromTitle,
} = require("../../../utils/documentChecklists/procedureExtractor");
const {
  processDocumentChecklists,
} = require("../../../utils/documentChecklists/processDocuments");
const {
  createChecklistRepository,
} = require("../../../utils/documentChecklists/repository");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Synthetic page that mimics the handbook table layout with placeholder
// wording only (no hospital text). Width ~9.4pt per glyph like the PDF.
const CELL_LEFT = 152;
const CELL_RIGHT = 530;
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
function marker(y, chars) {
  return [...chars].map((str, i) => ({
    str,
    x: 68.7,
    y: y - i * 16,
    w: 9.4,
    h: 10,
  }));
}
function fillLine(y, prefixWords) {
  // words that run up to the right cell edge
  const items = words(y, CELL_LEFT, prefixWords);
  const last = items[items.length - 1];
  const remaining = CELL_RIGHT - (last.x + last.w) - 4.5;
  if (remaining > 9.4) {
    const glyphs = Math.floor(remaining / 9.4);
    items.push({
      str: "가".repeat(glyphs),
      x: last.x + last.w + 4.5,
      y,
      w: glyphs * 9.4,
      h: 10,
    });
  }
  return items;
}

function standardLayout({
  extraLabel = "검사 전 준비",
  branch = false,
  nested = false,
  extraDetail = null,
} = {}) {
  const items = [
    ...words(791, 252, ["2026-04", "머리말"], 9),
    ...words(752, 239, ["가상시술술", "ABCD"], 15),
    ...words(730, 210, ["(Alpha", "Beta", "Gamma)"], 12),
    ...marker(580, "검사전"),
    ...words(692, 100, ["검사목적"]),
    ...fillLine(700, ["첫째", "설명"]),
    ...words(684, CELL_LEFT, ["둘째", "줄로", "이어짐"]),
    ...words(641, 104.7, ["동의서"]),
    ...words(641, CELL_LEFT, ["①", "가상", "동의서", "②", "가상", "점검표"]),
    ...words(590, 100, ["금식여부"]),
    ...words(590, CELL_LEFT, ["MN", "NPO"]),
    ...words(590, 323, ["IV", "line"]),
    ...words(590, 377, ["20G"]),
    ...words(533, 90.3, extraLabel.split(" ")),
    ...words(541, CELL_LEFT, ["가상", "준비물", "하나"]),
    ...words(525, CELL_LEFT, ["※", "가상", "참고", "문장"]),
  ];
  if (branch) items.push(...words(517, CELL_LEFT, ["<A인경우>"]));
  if (nested) {
    items.push(...words(509, CELL_LEFT + 60, ["들여쓴", "하위표"]));
    items.push(...words(501, CELL_LEFT + 60, ["들여쓴", "두번째"]));
  }
  items.push(
    ...words(478, 101, ["Prepare"]),
    ...words(478, CELL_LEFT, ["가상", "물품"]),
    ...words(441, 98, ["검사장소", "/"]),
    ...words(425, 100, ["이동수단"]),
    ...words(433, CELL_LEFT, ["1층", "가상실", "/", "S-car"]),
    ...marker(286, "검사후"),
    ...words(362, 109, ["식이"]),
    ...words(362, CELL_LEFT, ["-"]),
    ...words(301, 109, ["자세"]),
    ...words(301, CELL_LEFT, ["가상", "자세", "유지"]),
    ...words(248, 99, ["X-ray", "및"]),
    ...words(232, 110, ["Lab"]),
    ...words(240, CELL_LEFT, ["가상", "촬영"]),
    ...words(163, 100, ["관찰사항"]),
    ...words(171, CELL_LEFT, ["가상", "관찰", "하나"]),
    ...words(155, CELL_LEFT, ["(괄호", "설명)"]),
    ...words(44, 141, ["꼬리말"], 9)
  );
  if (extraDetail) items.push(...words(147, CELL_LEFT, [extraDetail]));
  const pageContent = (
    extraDetail ? items.filter((item) => item.str !== extraDetail) : items
  )
    .map((item) => item.str)
    .join("\n");
  return { layout: { width: 595, height: 842, items }, text: pageContent };
}

function extract(options = {}) {
  const { layout, text } = standardLayout(options);
  return extractProcedureChecklist({
    documentId: "doc-1",
    filename: "가상 문서.pdf",
    page: 7,
    text,
    layout,
  });
}

test("standard page becomes an active checklist built only from the page", () => {
  const checklist = extract();
  assert.equal(checklist.status, "active");
  assert.equal(checklist.active, true);
  assert.deepEqual(checklist.validation.problems, []);
  assert.equal(checklist.title, "가상시술술 ABCD");
  assert.deepEqual(checklist.aliases, [
    "가상시술술",
    "ABCD",
    "Alpha Beta Gamma",
  ]);
  assert.deepEqual(
    checklist.sections.map((section) => section.title),
    ["검사 전", "검사 후"]
  );
  const items = Object.fromEntries(
    checklist.sections
      .flatMap((section) => section.items)
      .map((item) => [item.label, item])
  );
  // a sentence that only wrapped at the cell edge is restored as one detail
  assert.equal(items["검사목적"].details.length, 1);
  assert.equal(items["검사목적"].type, "informational");
  assert.deepEqual(items["동의서"].details, ["① 가상 동의서", "② 가상 점검표"]);
  assert.deepEqual(items["금식여부"].details, ["MN NPO"]);
  assert.deepEqual(items["IV line"].details, ["20G"]);
  assert.deepEqual(items["검사 전 준비"].details, [
    "가상 준비물 하나",
    "※ 가상 참고 문장",
  ]);
  assert.equal(items["검사장소/이동수단"].type, "informational");
  assert.equal(
    items["식이"].type,
    "informational",
    "'-' only means nothing to check"
  );
  assert.equal(items["관찰사항"].type, "checkable");
  assert.deepEqual(items["관찰사항"].details, [
    "가상 관찰 하나",
    "(괄호 설명)",
  ]);
  assert.equal(checklist.source.page, 7);
});

test("ids are namespaced by checklist so equal labels never share state", () => {
  const a = extract();
  const { layout, text } = standardLayout();
  const b = extractProcedureChecklist({
    documentId: "doc-1",
    filename: "x.pdf",
    page: 8,
    text,
    layout,
  });
  const idsA = a.sections.flatMap((s) => s.items.map((i) => i.id));
  const idsB = b.sections.flatMap((s) => s.items.map((i) => i.id));
  assert.notEqual(a.id, b.id);
  assert.equal(idsA.filter((id) => idsB.includes(id)).length, 0);
});

test("pages with branch markers are not generated", () => {
  assert.equal(extract({ branch: true }), null);
});

test("a nested table inside one cell is kept for review, not activated", () => {
  const checklist = extract({ nested: true });
  assert.equal(checklist.status, "needs_review");
  assert.equal(checklist.active, false);
  assert.ok(checklist.validation.problems.includes("nested-layout"));
});

test("any text not present in the stored page text blocks activation", () => {
  const checklist = extract({ extraDetail: "원문에없는문장" });
  assert.equal(checklist.status, "needs_review");
  assert.ok(checklist.validation.problems.includes("detail-order-or-missing"));
});

test("source label variants are kept exactly as printed", () => {
  const checklist = extract({ extraLabel: "시술 전 준비" });
  const labels = checklist.sections.flatMap((s) => s.items.map((i) => i.label));
  assert.ok(labels.includes("시술 전 준비"));
  assert.ok(!labels.includes("검사 전 준비"));
});

test("non template pages are rejected by the text gate", () => {
  assert.equal(isStandardProcedurePage("가상 목록\n처방 안내"), false);
  assert.equal(isStandardProcedurePage(""), false);
});

test("aliases come from the title only and avoid generic or two-letter words", () => {
  assert.deepEqual(
    aliasesFromTitle(
      ["척수강 내 약물투여 IT CTx"],
      ["Intrathecal chemotherapy"]
    ),
    ["척수강 내 약물투여", "CTx", "IT CTx", "Intrathecal chemotherapy"]
  );
  assert.deepEqual(
    aliasesFromTitle(["전립선 생검 Prostate Biopsy : Prof. 가나다"], []),
    ["전립선 생검", "Prostate Biopsy"]
  );
  assert.deepEqual(
    aliasesFromTitle(["24시간 홀터 심전도"], ["Holter monitor"]),
    ["24시간 홀터 심전도", "Holter monitor"]
  );
  assert.deepEqual(aliasesFromTitle(["뇌혈관 조영술 : TFCA"], []), [
    "뇌혈관 조영술",
    "TFCA",
  ]);
  assert.deepEqual(aliasesFromTitle(["흉수천자 Thoracentesis : 병동"], []), [
    "흉수천자",
    "Thoracentesis",
  ]);
});

test("processing uses the generic engine for template pages and never throws", async () => {
  const { layout, text } = standardLayout();
  const saved = [];
  const result = await processDocumentChecklists(
    [{ location: "a.json" }, { location: "b.json" }, { location: "c.json" }],
    {
      loadDocument: async ({ location }) =>
        location === "c.json"
          ? {
              document_id: "doc-2",
              title: "가상.pdf",
              page: 1,
              pageContent: "일반 설명",
            }
          : {
              document_id: "doc-1",
              title: "가상.pdf",
              page: location === "a.json" ? 7 : 8,
              pageContent: text,
            },
      loadLayouts: async (documentId, pages) =>
        new Map(pages.map((page) => [page, layout])),
      repository: {
        saveAutoChecklist(checklist) {
          saved.push(checklist);
          return { created: true, checklist };
        },
      },
      logger: null,
    }
  );
  assert.deepEqual(result, { created: 2, skipped: 1, errors: 0, review: 0 });
  assert.deepEqual(
    saved.map((c) => c.page),
    [7, 8]
  );

  const failing = await processDocumentChecklists([{ location: "a.json" }], {
    loadDocument: async () => ({
      document_id: "doc-1",
      title: "가상.pdf",
      page: 7,
      pageContent: text,
    }),
    loadLayouts: async () => {
      throw new Error("pdf unavailable");
    },
    repository: { saveAutoChecklist: () => assert.fail("must not save") },
    logger: null,
  });
  assert.deepEqual(failing, { created: 0, skipped: 0, errors: 1, review: 0 });
});

test("review checklists are stored inactive and hidden from employee listings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "checklists-"));
  const repository = createChecklistRepository({ storageRoot: root });
  const review = extract({ nested: true });
  const active = (() => {
    const { layout, text } = standardLayout();
    return extractProcedureChecklist({
      documentId: "doc-1",
      filename: "x.pdf",
      page: 9,
      text,
      layout,
    });
  })();
  repository.saveAutoChecklist(review);
  repository.saveAutoChecklist(active);
  const stored = repository.getById(review.id);
  assert.equal(stored.status, "needs_review");
  assert.equal(stored.active, false);
  assert.deepEqual(
    repository.findByDocumentIds(["doc-1"]).map((c) => c.id),
    [active.id]
  );
  assert.deepEqual(
    repository
      .findByDocumentIds(["doc-1"], { includeReview: true })
      .map((c) => c.page),
    [7, 9]
  );
  // unchanged content is not rewritten (keeps verified files byte-identical)
  const before = fs
    .readdirSync(root)
    .map((f) => fs.readFileSync(path.join(root, f), "utf8"));
  const again = repository.saveAutoChecklist({
    ...active,
    updatedAt: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(again.created, false);
  const after = fs
    .readdirSync(root)
    .map((f) => fs.readFileSync(path.join(root, f), "utf8"));
  assert.deepEqual(after, before);
});
