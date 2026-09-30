// A new edition of the "검사 및 시술" or 수술 handbook gets a new document_id.
// Identical checklists are published again, everything else waits for review.
// Synthetic pages only (placeholder wording, no hospital text).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  processDocumentChecklists,
} = require("../../../utils/documentChecklists/processDocuments");
const {
  createChecklistRepository,
} = require("../../../utils/documentChecklists/repository");
const {
  extractProcedureChecklist,
  procedureTemplateFor,
} = require("../../../utils/documentChecklists/procedureExtractor");
const {
  checklistDocumentKind,
} = require("../../../utils/documentChecklists/versionMatch");
const {
  toPublicChecklist,
} = require("../../../utils/documentChecklists/presenter");

const CELL_LEFT = 152;
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
function asPage(items) {
  return {
    layout: { width: 595, height: 842, items },
    text: items.map((item) => item.str).join("\n"),
  };
}

// 검사·시술 form (검사 전 / 검사 후).
function procedurePage({
  title = ["가상검사술", "ABCD"],
  fasting = ["금식", "6시간"],
  consent = ["①", "가상", "동의서", "②", "가상", "점검표"],
  extraObservation = null,
} = {}) {
  const items = [
    ...words(752, 239, title, 15),
    ...marker(580, "검사전"),
    ...words(692, 100, ["검사목적"]),
    ...words(692, CELL_LEFT, ["가상", "목적", "설명"]),
    ...words(641, 104.7, ["동의서"]),
    ...words(641, CELL_LEFT, consent),
    ...words(590, 100, ["금식여부"]),
    ...words(590, CELL_LEFT, fasting),
    ...words(590, 323, ["IV", "line"]),
    ...words(590, 377, ["20G"]),
    ...words(533, 90.3, ["검사", "전", "준비"]),
    ...words(533, CELL_LEFT, ["가상", "준비물", "하나"]),
    ...words(478, 101, ["Prepare"]),
    ...words(478, CELL_LEFT, ["가상", "물품"]),
    ...words(441, 98, ["검사장소", "/"]),
    ...words(425, 100, ["이동수단"]),
    ...words(433, CELL_LEFT, ["1층", "가상실"]),
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
  ];
  if (extraObservation) items.push(...words(147, CELL_LEFT, extraObservation));
  return asPage(items);
}

// 수술 form (수술 전 / 수술 후 with the operating-room rows).
function surgeryPage({
  title = ["가상수술", "WXYZ"],
  after = ["가상", "관찰", "하나"],
  site = ["가상", "표시"],
} = {}) {
  return asPage([
    ...words(752, 239, title, 15),
    ...marker(580, "수술전"),
    ...words(700, 104.7, ["동의서"]),
    ...words(700, CELL_LEFT, ["①", "가상", "수술", "동의서"]),
    ...words(660, 100, ["금식여부"]),
    ...words(660, CELL_LEFT, ["금식", "8시간"]),
    ...words(660, 323, ["IV", "line"]),
    ...words(660, 377, ["18G"]),
    // one row, three labels side by side (as in the handbook)
    ...words(620, 100, ["수술부위"]),
    ...words(604, 109, ["표시"]),
    ...words(620, CELL_LEFT, site),
    ...words(620, 203, ["피부준비"]),
    ...words(604, 212, ["(면도)"]),
    ...words(620, 290, ["가상", "면도"]),
    ...words(620, 395, ["적정성"]),
    ...words(605, 380, ["(CI,", "예방적항생제)"]),
    ...words(620, 470, ["가상", "확인"]),
    ...words(500, 90.3, ["수술", "전", "준비"]),
    ...words(500, CELL_LEFT, ["가상", "준비물"]),
    ...words(470, 101, ["Prepare"]),
    ...words(470, CELL_LEFT, ["가상", "물품"]),
    ...words(440, 98, ["검사장소", "/"]),
    ...words(424, 100, ["이동수단"]),
    ...words(432, CELL_LEFT, ["수술실", "/", "침대"]),
    ...marker(286, "수술후"),
    ...words(362, 109, ["식이"]),
    ...words(362, CELL_LEFT, ["가상", "식이"]),
    ...words(301, 109, ["자세"]),
    ...words(301, CELL_LEFT, ["가상", "자세"]),
    ...words(248, 99, ["X-ray", "및"]),
    ...words(232, 110, ["Lab"]),
    ...words(240, CELL_LEFT, ["가상", "촬영"]),
    ...words(163, 100, ["관찰사항"]),
    ...words(171, CELL_LEFT, after),
  ]);
}

function tempRepository() {
  return createChecklistRepository({
    storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "checklist-versions-")),
  });
}

/** Processes one uploaded edition: pages = [{ page, text, layout }]. */
async function upload(repository, { documentId, filename, pages }, extra = {}) {
  const byPage = new Map(pages.map((page) => [page.page, page]));
  return processDocumentChecklists(
    pages.map((page) => ({ location: `${documentId}-${page.page}` })),
    {
      loadDocument: async ({ location }) => {
        const page = Number(location.split("-").pop());
        return {
          document_id: documentId,
          title: filename,
          page,
          pageContent: byPage.get(page).text,
        };
      },
      loadLayouts: async (_id, numbers) =>
        new Map(numbers.map((number) => [number, byPage.get(number).layout])),
      repository,
      logger: null,
      ...extra,
    }
  );
}

const PROCEDURE_V1 = "검사 및 시술(26.04.07).pdf";
const PROCEDURE_V2 = "검사 및 시술(26.10.01).pdf";
const SURGERY_V1 = "수술 간호 지침(26.04).pdf";
const SURGERY_V2 = "수술 간호 지침(26.10).pdf";

function forDocument(repository, documentId) {
  return repository
    .findByDocumentIds([documentId], { includeReview: true })
    .reduce((map, checklist) => map.set(checklist.title, checklist), new Map());
}

/** Uploads v1 and publishes every checklist, as an administrator would. */
async function publishedFirstEdition(
  repository,
  pages,
  filename = PROCEDURE_V1
) {
  await upload(repository, { documentId: "doc-v1", filename, pages });
  for (const checklist of repository.findByDocumentIds(["doc-v1"], {
    includeReview: true,
  }))
    repository.setStatus(checklist.id, "active");
}

test("only 검사 및 시술 and 수술 documents are extraction targets", () => {
  assert.equal(
    checklistDocumentKind("검사 및 시술(26.04.07).pdf"),
    "procedure"
  );
  assert.equal(checklistDocumentKind("검사및시술_2026개정.pdf"), "procedure");
  assert.equal(checklistDocumentKind("수술 간호 지침.pdf"), "surgery");
  assert.equal(checklistDocumentKind("2026실무지침서 (26.7).pdf"), null);
});

test("a general guideline document is not processed even with a form page", async () => {
  const repository = tempRepository();
  const result = await upload(repository, {
    documentId: "guide",
    filename: "2026실무지침서 (26.7).pdf",
    pages: [{ page: 3, ...procedurePage() }],
  });
  assert.equal(result.skipped, 1);
  assert.equal(repository.listAll().length, 0);
});

test("[1][2] new edition with a new file name: identical checklist is published again", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [{ page: 7, ...procedurePage() }]);
  const result = await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [{ page: 7, ...procedurePage() }],
  });
  assert.equal(result.autoPublished, 1);
  const [checklist] = repository.findByDocumentIds(["doc-v2"]);
  assert.equal(checklist.status, "active");
  assert.equal(checklist.autoPublished, true);
  assert.equal(checklist.versionMatch.result, "same");
  assert.equal(checklist.source.filename, PROCEDURE_V2);
  // the first edition's checklist is not touched
  assert.equal(repository.findByDocumentIds(["doc-v1"]).length, 1);
});

test("[3] a checklist that moved to another page is still the same checklist", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [{ page: 7, ...procedurePage() }]);
  await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [{ page: 12, ...procedurePage() }],
  });
  const [checklist] = repository.findByDocumentIds(["doc-v2"]);
  assert.equal(checklist.page, 12);
  assert.equal(checklist.status, "active");
});

test("[4] a changed number (금식 6시간 → 8시간) waits for review", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [{ page: 7, ...procedurePage() }]);
  const result = await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [{ page: 7, ...procedurePage({ fasting: ["금식", "8시간"] }) }],
  });
  assert.equal(result.autoPublished, 0);
  assert.deepEqual(repository.findByDocumentIds(["doc-v2"]), []);
  const [review] = repository.findByDocumentIds(["doc-v2"], {
    includeReview: true,
  });
  assert.equal(review.status, "needs_review");
  assert.equal(review.versionMatch.result, "changed");
  assert.ok(
    toPublicChecklist(review).reviewReasons.includes("version-changed")
  );
});

test("[5] an added line waits for review", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [{ page: 7, ...procedurePage() }]);
  await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [
      {
        page: 7,
        ...procedurePage({ extraObservation: ["가상", "관찰", "둘"] }),
      },
    ],
  });
  const [review] = repository.findByDocumentIds(["doc-v2"], {
    includeReview: true,
  });
  assert.equal(review.status, "needs_review");
  assert.equal(review.versionMatch.result, "changed");
});

test("[6] a removed line waits for review", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [{ page: 7, ...procedurePage() }]);
  await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [
      { page: 7, ...procedurePage({ consent: ["①", "가상", "동의서"] }) },
    ],
  });
  const [review] = repository.findByDocumentIds(["doc-v2"], {
    includeReview: true,
  });
  assert.equal(review.status, "needs_review");
  assert.equal(review.versionMatch.result, "changed");
});

test("[7] a completely new exam waits for review", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [{ page: 7, ...procedurePage() }]);
  await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [
      { page: 7, ...procedurePage() },
      { page: 8, ...procedurePage({ title: ["새로운검사", "EFGH"] }) },
    ],
  });
  const byTitle = forDocument(repository, "doc-v2");
  assert.equal(byTitle.get("가상검사술 ABCD").status, "active");
  const fresh = byTitle.get("새로운검사 EFGH");
  assert.equal(fresh.status, "needs_review");
  assert.equal(fresh.versionMatch.result, "new");
  assert.ok(toPublicChecklist(fresh).reviewReasons.includes("version-new"));
});

test("[8] a surgery form page is extracted from the page itself", () => {
  const { layout, text } = surgeryPage();
  assert.equal(procedureTemplateFor(text).kind, "surgery");
  const checklist = extractProcedureChecklist({
    documentId: "surgery-v1",
    filename: SURGERY_V1,
    page: 4,
    text,
    layout,
  });
  assert.equal(checklist.status, "active", checklist.validation.problems);
  assert.equal(checklist.templateKind, "surgery");
  assert.equal(checklist.title, "가상수술 WXYZ");
  assert.deepEqual(
    checklist.sections.map((section) => section.title),
    ["수술 전", "수술 후"]
  );
  assert.deepEqual(
    checklist.sections[0].items.map((item) => item.label),
    [
      "동의서",
      "금식여부",
      "IV line",
      "수술부위 표시",
      "피부준비 (면도)",
      "적정성 (CI, 예방적항생제)",
      "수술 전 준비",
      "Prepare",
      "검사장소/이동수단",
    ]
  );
  assert.deepEqual(checklist.sections[0].items[1].details, ["금식 8시간"]);
  assert.deepEqual(checklist.sections[1].items[3].details, ["가상 관찰 하나"]);
});

test("[9] the same surgery in a new edition is published again", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(
    repository,
    [{ page: 4, ...surgeryPage() }],
    SURGERY_V1
  );
  const result = await upload(repository, {
    documentId: "doc-v2",
    filename: SURGERY_V2,
    pages: [{ page: 5, ...surgeryPage() }],
  });
  assert.equal(result.autoPublished, 1);
  assert.equal(repository.findByDocumentIds(["doc-v2"]).length, 1);
});

test("[10] a changed surgery (after-care line) waits for review", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(
    repository,
    [{ page: 4, ...surgeryPage() }],
    SURGERY_V1
  );
  await upload(repository, {
    documentId: "doc-v2",
    filename: SURGERY_V2,
    pages: [{ page: 4, ...surgeryPage({ after: ["가상", "관찰", "셋"] }) }],
  });
  assert.deepEqual(repository.findByDocumentIds(["doc-v2"]), []);
  const [review] = repository.findByDocumentIds(["doc-v2"], {
    includeReview: true,
  });
  assert.equal(review.versionMatch.result, "changed");
});

test("[11] different exams are never linked to each other", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [
    { page: 7, ...procedurePage({ title: ["가상검사술", "ABCD"] }) },
    {
      page: 8,
      ...procedurePage({
        title: ["다른검사술", "EFGH"],
        fasting: ["금식", "4시간"],
      }),
    },
  ]);
  // v2: ABCD unchanged; EFGH now reads like ABCD's old content except its title
  await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [
      { page: 7, ...procedurePage({ title: ["가상검사술", "ABCD"] }) },
      { page: 8, ...procedurePage({ title: ["다른검사술", "EFGH"] }) },
    ],
  });
  const byTitle = forDocument(repository, "doc-v2");
  assert.equal(byTitle.get("가상검사술 ABCD").status, "active");
  assert.equal(byTitle.get("다른검사술 EFGH").status, "needs_review");
  assert.equal(
    byTitle.get("다른검사술 EFGH").versionMatch.previousId,
    forDocument(repository, "doc-v1").get("다른검사술 EFGH").id
  );
});

test("[12] different surgeries are never linked, nor a surgery document to an exam", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(
    repository,
    [{ page: 4, ...surgeryPage({ title: ["가상수술", "WXYZ"] }) }],
    SURGERY_V1
  );
  await upload(repository, {
    documentId: "doc-v2",
    filename: SURGERY_V2,
    pages: [{ page: 4, ...surgeryPage({ title: ["다른수술", "QRST"] }) }],
  });
  const [other] = repository.findByDocumentIds(["doc-v2"], {
    includeReview: true,
  });
  assert.equal(other.status, "needs_review");
  assert.equal(other.versionMatch.result, "new");

  // same title in a 검사 및 시술 document: a different kind of document
  await upload(repository, {
    documentId: "doc-procedure",
    filename: PROCEDURE_V2,
    pages: [{ page: 4, ...surgeryPage({ title: ["가상수술", "WXYZ"] }) }],
  });
  const [crossKind] = repository.findByDocumentIds(["doc-procedure"], {
    includeReview: true,
  });
  assert.equal(crossKind.status, "needs_review");
  assert.equal(crossKind.versionMatch.result, "new");
});

test("[13] administrator edits: carried over only when the source is identical", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [{ page: 7, ...procedurePage() }]);
  const [v1] = repository.findByDocumentIds(["doc-v1"]);
  const edited = JSON.parse(JSON.stringify(v1));
  edited.sections[0].items[1].details.push("관리자가 추가한 줄");
  repository.updateChecklist(v1.id, edited);
  const v1Before = JSON.stringify(repository.getById(v1.id));

  // identical source -> published with the administrator's edit
  await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [{ page: 7, ...procedurePage() }],
  });
  const [v2] = repository.findByDocumentIds(["doc-v2"]);
  assert.equal(v2.status, "active");
  assert.equal(v2.editedByAdmin, true);
  assert.ok(v2.sections[0].items[1].details.includes("관리자가 추가한 줄"));

  // changed source -> review, and the edit is NOT applied
  await upload(repository, {
    documentId: "doc-v3",
    filename: PROCEDURE_V2,
    pages: [{ page: 7, ...procedurePage({ fasting: ["금식", "8시간"] }) }],
  });
  const [v3] = repository.findByDocumentIds(["doc-v3"], {
    includeReview: true,
  });
  assert.equal(v3.status, "needs_review");
  assert.equal(v3.editedByAdmin, false);
  assert.ok(!v3.sections[0].items[1].details.includes("관리자가 추가한 줄"));

  // the first edition's edited checklist itself is never overwritten
  assert.equal(JSON.stringify(repository.getById(v1.id)), v1Before);
  await upload(repository, {
    documentId: "doc-v1",
    filename: PROCEDURE_V1,
    pages: [{ page: 7, ...procedurePage({ fasting: ["금식", "8시간"] }) }],
  });
  assert.equal(JSON.stringify(repository.getById(v1.id)), v1Before);
});

test("[14][15] employees see public checklists only; review ones only the administrator", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [{ page: 7, ...procedurePage() }]);
  await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [
      { page: 7, ...procedurePage() },
      { page: 8, ...procedurePage({ title: ["새로운검사", "EFGH"] }) },
    ],
  });
  assert.deepEqual(
    repository.findByDocumentIds(["doc-v2"]).map((c) => c.title),
    ["가상검사술 ABCD"]
  );
  assert.deepEqual(
    repository
      .findByDocumentIds(["doc-v2"], { includeReview: true })
      .map((c) => c.status),
    ["active", "needs_review"]
  );
});

test("a previous checklist that was not public is never published automatically", async () => {
  const repository = tempRepository();
  await upload(repository, {
    documentId: "doc-v1",
    filename: PROCEDURE_V1,
    pages: [{ page: 7, ...procedurePage() }],
  });
  const [v1] = repository.findByDocumentIds(["doc-v1"], {
    includeReview: true,
  });
  repository.setStatus(v1.id, "hidden");
  await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [{ page: 7, ...procedurePage() }],
  });
  const [v2] = repository.findByDocumentIds(["doc-v2"], {
    includeReview: true,
  });
  assert.equal(v2.status, "needs_review");
  assert.equal(v2.versionMatch.result, "previous-not-public");
});

test("two checklists with the same title in one edition are left for review", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [{ page: 7, ...procedurePage() }]);
  await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [
      { page: 7, ...procedurePage() },
      { page: 9, ...procedurePage() },
    ],
  });
  const statuses = repository
    .findByDocumentIds(["doc-v2"], { includeReview: true })
    .map((c) => [c.status, c.versionMatch.result]);
  assert.deepEqual(statuses, [
    ["needs_review", "ambiguous"],
    ["needs_review", "ambiguous"],
  ]);
});

test("checklists saved before this change (no fingerprint) still match", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [{ page: 7, ...procedurePage() }]);
  // simulate a legacy file: remove the stored source fingerprint
  for (const file of fs.readdirSync(repository.storageRoot)) {
    const full = path.join(repository.storageRoot, file);
    const value = JSON.parse(fs.readFileSync(full, "utf8"));
    delete value.sourceFingerprint;
    fs.writeFileSync(full, JSON.stringify(value));
  }
  await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [{ page: 7, ...procedurePage() }],
  });
  assert.equal(repository.findByDocumentIds(["doc-v2"]).length, 1);
});

test("a hand-written draft cannot be verified, so its new edition waits for review", async () => {
  const repository = tempRepository();
  await publishedFirstEdition(repository, [{ page: 7, ...procedurePage() }]);
  for (const file of fs.readdirSync(repository.storageRoot)) {
    const full = path.join(repository.storageRoot, file);
    const value = JSON.parse(fs.readFileSync(full, "utf8"));
    delete value.sourceFingerprint;
    value.draft = true;
    fs.writeFileSync(full, JSON.stringify(value));
  }
  await upload(repository, {
    documentId: "doc-v2",
    filename: PROCEDURE_V2,
    pages: [{ page: 7, ...procedurePage() }],
  });
  const [v2] = repository.findByDocumentIds(["doc-v2"], {
    includeReview: true,
  });
  assert.equal(v2.status, "needs_review");
  assert.equal(v2.versionMatch.result, "previous-unverifiable");
});

test("Renal biopsy in a new edition (page moved) is published again with its names", async () => {
  const renalText = fs.readFileSync(
    path.join(__dirname, "fixtures", "renal-biopsy-page-56.txt"),
    "utf8"
  );
  const repository = tempRepository();
  const renalUpload = (documentId, filename, page) =>
    processDocumentChecklists([{ location: "renal" }], {
      loadDocument: async () => ({
        document_id: documentId,
        title: filename,
        page,
        pageContent: renalText,
      }),
      repository,
      logger: null,
    });
  await renalUpload("doc-v1", PROCEDURE_V1, 56);
  const [v1] = repository.findByDocumentIds(["doc-v1"], {
    includeReview: true,
  });
  repository.setStatus(v1.id, "active");
  const result = await renalUpload("doc-v2", PROCEDURE_V2, 58);
  assert.equal(result.autoPublished, 1);
  const [v2] = repository.findByDocumentIds(["doc-v2"]);
  assert.equal(v2.page, 58);
  assert.deepEqual(v2.aliases, [
    "renal biopsy",
    "renal bx",
    "신장 조직검사",
    "신생검",
  ]);
});

test("an unreadable original PDF is reported, not skipped silently", async () => {
  const repository = tempRepository();
  const reported = [];
  const result = await upload(
    repository,
    {
      documentId: "doc-v2",
      filename: PROCEDURE_V2,
      pages: [{ page: 7, ...procedurePage() }],
    },
    {
      loadLayouts: async () => new Map(),
      onIssues: async (value) => reported.push(value),
    }
  );
  assert.equal(result.errors, 1);
  assert.deepEqual(result.failures, [
    { page: 7, reason: "pdf-layout-unavailable" },
  ]);
  assert.equal(reported.length, 1);
  assert.equal(repository.listAll().length, 0);
});
