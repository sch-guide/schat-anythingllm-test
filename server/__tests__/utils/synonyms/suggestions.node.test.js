// 동의어 자동 후보: 문서 등록 → 후보 → 검토 필요 → 관리자 승인 → 검색 적용.
// Uses an in-memory database and a fake Gemini; nothing real is touched.
const test = require("node:test");
const assert = require("node:assert/strict");

const Synonyms = require("../../../utils/synonyms");
const Suggestions = require("../../../utils/synonyms/suggestions");
const {
  toPublicChecklist,
} = require("../../../utils/documentChecklists/presenter");

function memoryPrisma(groups = [], documentIds = ["doc-a"]) {
  const db = {
    groups: groups.map((group, index) => ({
      id: index + 1,
      terms: JSON.stringify(group.terms),
      kind: "procedure",
      status: group.status || "active",
      source: group.source || "draft",
      note: null,
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
    })),
    suggestions: [],
    runs: [],
    writes: [],
  };
  let nextGroup = db.groups.length + 1;
  let nextSuggestion = 1;
  let nextRun = 1;
  const match = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const table = (rows, name, next) => ({
    findMany: async ({ where } = {}) =>
      rows()
        .filter((row) => match(row, where))
        .map((row) => ({ ...row })),
    findUnique: async ({ where }) => {
      const row = rows().find((item) => item.id === where.id);
      return row ? { ...row } : null;
    },
    create: async ({ data }) => {
      const row = {
        id: next(),
        createdAt: new Date(),
        lastUpdatedAt: new Date(),
        ...data,
      };
      if (name === "suggestions") row.status = row.status || "pending";
      rows().push(row);
      db.writes.push([name, "create", row.id]);
      return { ...row };
    },
    update: async ({ where, data }) => {
      const row = rows().find((item) => item.id === where.id);
      Object.assign(row, data);
      db.writes.push([name, "update", row.id]);
      return { ...row };
    },
    updateMany: async ({ where, data }) => {
      for (const row of rows().filter((item) => match(item, where)))
        Object.assign(row, data);
      db.writes.push([name, "updateMany"]);
    },
    delete: async ({ where }) => {
      const index = rows().findIndex((item) => item.id === where.id);
      rows().splice(index, 1);
      db.writes.push([name, "delete", where.id]);
    },
    deleteMany: async ({ where }) => {
      const keep = rows().filter((item) => !match(item, where));
      const count = rows().length - keep.length;
      rows().splice(0, rows().length, ...keep);
      db.writes.push([name, "deleteMany"]);
      return { count };
    },
  });
  const prisma = {
    schat_synonym_groups: table(
      () => db.groups,
      "groups",
      () => nextGroup++
    ),
    schat_synonym_suggestions: table(
      () => db.suggestions,
      "suggestions",
      () => nextSuggestion++
    ),
    schat_synonym_suggestion_runs: table(
      () => db.runs,
      "runs",
      () => nextRun++
    ),
    system_settings: { findUnique: async () => ({ value: "seeded" }) },
    workspace_documents: {
      findMany: async () =>
        documentIds.map((id) => ({
          metadata: JSON.stringify({ document_id: id }),
        })),
    },
  };
  let transactionTail = Promise.resolve();
  prisma.$transaction = (work) => {
    const result = transactionTail.then(async () => {
      const before = structuredClone(db);
      try {
        return typeof work === "function"
          ? await work(prisma)
          : await Promise.all(work);
      } catch (error) {
        Object.assign(db, before);
        throw error;
      }
    });
    transactionTail = result.catch(() => {});
    return result;
  };
  return { prisma, db };
}

function fakeGemini(groups, seen = []) {
  return {
    model: "gemini-test",
    getChatCompletion: async (messages) => {
      seen.push(messages.map((message) => message.content).join("\n"));
      if (groups instanceof Error) throw groups;
      return { textResponse: JSON.stringify({ groups }) };
    },
  };
}

// Ordinary page text around the test words, so a page is not "텍스트 부족".
const BODY =
  "\n시술 전 확인 사항\n시술 후 관찰\n" +
  "환자의 상태를 확인하고 필요한 준비물을 미리 챙긴 뒤 담당 부서와 일정과 준비 상태를 다시 확인한다.".repeat(
    2
  );

test("document filenames are never included in Gemini snippets", () => {
  const result = Suggestions.collectSnippets(
    [{ page: 1, pageContent: "기관지내시경 BFS" + BODY }],
    { documentName: "patient 010-1234-5678.pdf" }
  );
  assert.ok(result.batches.length > 0);
  assert.ok(
    !result.batches.some((batch) => batch.text.includes("010-1234-5678"))
  );
});

function approvalFixture() {
  const result = memoryPrisma([{ terms: ["기관지내시경", "BFS"] }]);
  result.db.suggestions.push(
    ...["Bronchoscopy", "Bronchofiberscopy"].map((term, i) => ({
      id: i + 1,
      type: "addition",
      group_id: 1,
      status: "pending",
      terms: JSON.stringify([term]),
    }))
  );
  return result;
}
test("concurrent additions cannot silently overwrite each other", async () => {
  const { prisma, db } = approvalFixture();
  await Promise.all([
    Suggestions.approveAddition(1, prisma),
    Suggestions.approveAddition(2, prisma),
  ]);
  assert.deepEqual(JSON.parse(db.groups[0].terms), [
    "기관지내시경",
    "BFS",
    "Bronchoscopy",
    "Bronchofiberscopy",
  ]);
  assert.ok(db.suggestions.every((row) => row.status === "approved"));
});
test("failure recording approval rolls back the group change", async () => {
  const { prisma, db } = approvalFixture();
  prisma.schat_synonym_suggestions.update = async () => {
    throw new Error("synthetic write failure");
  };
  await assert.rejects(
    Suggestions.approveAddition(1, prisma),
    /synthetic write failure/
  );
  assert.deepEqual(JSON.parse(db.groups[0].terms), ["기관지내시경", "BFS"]);
  assert.equal(db.suggestions[0].status, "pending");
});

test("upload scheduling returns before slow Gemini generation finishes", async () => {
  const { prisma } = memoryPrisma();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let settled = false;
  const scheduled = Suggestions.scheduleSynonymSuggestions(
    [{ location: "synthetic" }],
    {
      prisma,
      loadDocument: async () => ({
        document_id: "doc-a",
        title: "synthetic.txt",
        page: 1,
        pageContent: "기관지내시경 BFS Bronchofiberscopy" + BODY,
      }),
      llm: {
        getChatCompletion: async () => {
          await gate;
          return { textResponse: '{"groups":[]}' };
        },
      },
      logEvent: async () => null,
    }
  );
  scheduled.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
  try {
    assert.equal(settled, true, "upload must not wait for provider completion");
  } finally {
    release();
    const result = await scheduled;
    await result?.completion;
  }
});
const page13 = {
  page: 13,
  section: "",
  pageContent: [
    "2026-04간호교육파트",
    "변경사항있으면041-589-6741로연락주십시오.",
    "기관지내시경BFS",
    "Bronchofiberscopy",
    "Prepare:서기현교수님만사용",
    "외래진료가없는경우:☎2387(검사실)",
    "혈액투석 HD catheter 관리",
    "Hemodialysis 시행 전 확인",
  ].join("\n"),
};
const page14 = {
  page: 14,
  section: "",
  pageContent: "2026-04간호교육파트\n흉수천자 thoracentesis\n흉관 chest tube",
};
const page15 = {
  page: 15,
  section: "",
  pageContent:
    "2026-04간호교육파트\n중심정맥카테터(central venous catheter, CVC)",
};
const document = (pages = [page13, page14, page15], id = "doc-a") => [
  { documentId: id, documentName: "검사 및 시술(26.04.07).pdf", pages },
];
const candidate = (terms, extra = {}) => ({
  terms,
  category: "검사·시술",
  confidence: 0.95,
  reason: "같은 제목에서 함께 쓰임",
  pages: [13],
  ...extra,
});

const draftGroups = [
  { terms: ["기관지내시경", "bronchoscopy", "BFS"] },
  { terms: ["HD", "혈액투석", "hemodialysis"], status: "off" },
  { terms: ["흉관", "chest tube"] },
];

test("1·2. a new document creates suggestions, all 검토 필요 and 자동 제안", async () => {
  const { prisma, db } = memoryPrisma(draftGroups);
  const result = await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini([
      candidate(["중심정맥카테터", "central venous catheter", "CVC"], {
        category: "카테터·라인",
        pages: [15],
      }),
    ]),
    logEvent: async () => null,
  });
  assert.equal(result.newGroups, 1);
  const created = db.groups.filter((group) => group.source === "auto");
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "needs_review");
  assert.deepEqual(JSON.parse(created[0].terms), [
    "중심정맥카테터",
    "central venous catheter",
    "CVC",
  ]);
  const [row] = db.suggestions;
  assert.equal(row.type, "group");
  assert.equal(row.group_id, created[0].id);
  assert.equal(row.category, "용어");
  assert.equal(row.confidence, 0.95);
  assert.match(row.method, /^gemini-titles-v1:gemini-test$/);
  assert.deepEqual(JSON.parse(row.sources), [
    {
      documentId: "doc-a",
      documentName: "검사 및 시술(26.04.07).pdf",
      pages: [15],
    },
  ]);
});

test("3·4. a 검토 필요 suggestion is not used by search until approved", async () => {
  Synonyms.invalidate();
  const { prisma, db } = memoryPrisma(draftGroups);
  await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini([
      candidate(["중심정맥카테터", "central venous catheter", "CVC"]),
    ]),
    logEvent: async () => null,
  });
  const before = await Synonyms.getActiveGroups(prisma);
  assert.equal(
    before.some((group) => group.terms.includes("CVC")),
    false
  );
  const alternatives = Synonyms.termAlternatives(["cvc"], before);
  assert.deepEqual(alternatives.get("cvc"), ["cvc"]);

  const auto = db.groups.find((group) => group.source === "auto");
  await Synonyms.updateGroup(auto.id, { status: "active" }, prisma);
  const after = await Synonyms.getActiveGroups(prisma);
  assert.deepEqual(
    Synonyms.termAlternatives(["cvc"], after).get("cvc"),
    ["cvc", "중심정맥카테터", "centralvenouscatheter"].filter(
      (term) => !/\s/.test(term)
    )
  );
  Synonyms.invalidate();
});

test("5. checklist names use a suggestion only after approval", async () => {
  Synonyms.invalidate();
  const { prisma, db } = memoryPrisma([]);
  await Suggestions.suggestForDocuments(
    document([
      {
        page: 20,
        pageContent: `투석카테터 삽입\n투석카테터 = dialysis catheter${BODY}`,
      },
    ]),
    {
      prisma,
      llm: fakeGemini([
        candidate(["투석카테터", "dialysis catheter"], { pages: [20] }),
      ]),
      logEvent: async () => null,
    }
  );
  const checklist = {
    id: "c1",
    documentId: "doc-a",
    title: "투석카테터 삽입",
    aliases: ["투석카테터 삽입"],
    page: 20,
    status: "active",
    items: [],
  };
  const aliasesWith = async () =>
    toPublicChecklist(checklist, {
      synonymGroups: await Synonyms.getActiveGroups(prisma),
    }).searchAliases;
  assert.equal((await aliasesWith()).includes("dialysis catheter 삽입"), false);
  const auto = db.groups.find((group) => group.source === "auto");
  await Synonyms.updateGroup(auto.id, { status: "active" }, prisma);
  assert.equal((await aliasesWith()).includes("dialysis catheter 삽입"), true);
  Synonyms.invalidate();
});

test("6. the same words as an existing group (case, spaces, order) create nothing", async () => {
  const { prisma, db } = memoryPrisma(draftGroups);
  const result = await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini([
      candidate(["BFS", "기관지 내시경"]),
      candidate(["Hemodialysis", "혈액투석", "HD"]),
    ]),
    logEvent: async () => null,
  });
  assert.equal(result.newGroups, 0);
  assert.equal(result.additions, 0);
  assert.equal(result.duplicates, 2);
  assert.equal(db.suggestions.length, 0);
  assert.equal(db.groups.length, draftGroups.length);
});

test("7. one new word for an existing group becomes an addition only", async () => {
  const { prisma, db } = memoryPrisma(draftGroups);
  const original = db.groups.map((group) => ({ ...group }));
  const result = await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini([candidate(["기관지내시경", "BFS", "Bronchofiberscopy"])]),
    logEvent: async () => null,
  });
  assert.equal(result.additions, 1);
  assert.equal(result.newGroups, 0);
  // the existing group is not changed automatically
  assert.deepEqual(db.groups, original);
  const [row] = db.suggestions;
  assert.equal(row.type, "addition");
  assert.equal(row.group_id, 1);
  assert.deepEqual(JSON.parse(row.terms), ["Bronchofiberscopy"]);

  // shown on the admin list under the existing group, in 검토 필요
  const listed = await Synonyms.listGroups(prisma);
  assert.deepEqual(listed[0].pendingAdditions[0].terms, ["Bronchofiberscopy"]);
  assert.equal(listed[0].status, "active");

  // approval adds the word; a dismissed word is never suggested again
  const saved = await Suggestions.approveAddition(row.id, prisma);
  assert.deepEqual(saved.terms, [
    "기관지내시경",
    "bronchoscopy",
    "BFS",
    "Bronchofiberscopy",
  ]);
  assert.equal(db.suggestions[0].status, "approved");
  Synonyms.invalidate();
});

test("7-1. a dismissed addition is not suggested again", async () => {
  const { prisma, db } = memoryPrisma(draftGroups);
  const llm = fakeGemini([candidate(["기관지내시경", "Bronchofiberscopy"])]);
  await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm,
    logEvent: async () => null,
  });
  assert.equal(await Suggestions.dismissAddition(1, prisma), true);
  const again = await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm,
    logEvent: async () => null,
  });
  assert.equal(again.additions, 0);
  assert.equal(db.suggestions.length, 1);
});

test("8. unclear candidates are never stored, and nothing is ever 사용", async () => {
  const { prisma, db } = memoryPrisma(draftGroups);
  await Suggestions.suggestForDocuments(
    document([
      {
        page: 30,
        pageContent:
          "PICC 삽입 PICC 제거\nPICC insertion\nPICC removal\n세프트리악손 세포탁심\nAST 피부반응검사\nBFS 흉관",
      },
    ]),
    {
      prisma,
      llm: fakeGemini([
        // insertion and removal mixed
        candidate(["PICC insertion", "PICC removal"], { pages: [30] }),
        // low confidence
        candidate(["AST", "피부반응검사"], { confidence: 0.4, pages: [30] }),
        // a word that is not in the document
        candidate(["세프트리악손", "Rocephin"], { pages: [30] }),
        // overlaps two existing groups
        candidate(["BFS", "흉관"], { pages: [30] }),
      ]),
      logEvent: async () => null,
    }
  );
  assert.equal(db.suggestions.length, 0);
  assert.equal(db.groups.filter((group) => group.source === "auto").length, 0);
  // a lower-confidence candidate is kept for review with a label
  const second = memoryPrisma(draftGroups);
  await Suggestions.suggestForDocuments(
    document([{ page: 30, pageContent: `AST 피부반응검사${BODY}` }]),
    {
      prisma: second.prisma,
      llm: fakeGemini([
        candidate(["AST", "피부반응검사"], { confidence: 0.6, pages: [30] }),
      ]),
      logEvent: async () => null,
    }
  );
  const listed = await Synonyms.listGroups(second.prisma);
  const auto = listed.find((group) => group.source === "auto");
  assert.equal(auto.status, "needs_review");
  assert.equal(auto.suggestion.lowConfidence, true);
  assert.equal(
    second.db.groups.some(
      (group) => group.source === "auto" && group.status === "active"
    ),
    false
  );
});

test("9. a Gemini failure leaves only a system log and never throws", async () => {
  const { prisma, db } = memoryPrisma(draftGroups);
  const events = [];
  const errors = [];
  const result = await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini(new Error("429 quota exceeded")),
    logEvent: async (event, data) => events.push([event, data]),
    logger: { error: (message) => errors.push(message) },
    sleep: async () => null,
  });
  assert.deepEqual(result.failedDocuments, [
    { documentName: "검사 및 시술(26.04.07).pdf", code: "rate_limited" },
  ]);
  assert.equal(result.failed, 1);
  // retried at most three times, then the document is marked failed
  assert.equal(result.retries, 3);
  assert.equal(events[0][0], "schat_synonym_suggestion_failed");
  assert.equal(events[0][1].message, "동의어 후보 자동 생성 실패");
  assert.equal(db.writes.filter(([name]) => name !== "runs").length, 0);

  // the upload hook itself never throws, even with unreadable documents
  const run = await Suggestions.scheduleSynonymSuggestions(
    [{ location: "missing.json" }],
    {
      loadDocument: async () => {
        throw new Error("unreadable");
      },
    }
  );
  assert.equal(run, null);
});

test("10. a new edition does not create the same suggestion twice", async () => {
  const { prisma, db } = memoryPrisma(draftGroups, ["doc-a", "doc-b"]);
  const llm = fakeGemini([
    candidate(["중심정맥카테터", "central venous catheter", "CVC"], {
      pages: [15],
    }),
  ]);
  await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm,
    logEvent: async () => null,
  });
  const second = await Suggestions.suggestForDocuments(
    document(undefined, "doc-b"),
    { prisma, llm, logEvent: async () => null }
  );
  assert.equal(second.newGroups, 0);
  assert.equal(db.groups.filter((group) => group.source === "auto").length, 1);
  assert.equal(db.suggestions.length, 1);
  assert.deepEqual(
    JSON.parse(db.suggestions[0].sources).map((source) => source.documentId),
    ["doc-a", "doc-b"]
  );
  assert.deepEqual(JSON.parse(db.suggestions[0].sources)[1].pages, [15]);
});

test("10-1. a new edition with one new word adds only that word as a candidate", async () => {
  const { prisma, db } = memoryPrisma(draftGroups, ["doc-a", "doc-b"]);
  await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini([candidate(["중심정맥카테터", "CVC"], { pages: [15] })]),
    logEvent: async () => null,
  });
  await Suggestions.suggestForDocuments(document(undefined, "doc-b"), {
    prisma,
    llm: fakeGemini([
      candidate(["중심정맥카테터", "CVC", "central venous catheter"], {
        pages: [15],
      }),
    ]),
    logEvent: async () => null,
  });
  assert.equal(db.groups.filter((group) => group.source === "auto").length, 1);
  const addition = db.suggestions.find((row) => row.type === "addition");
  assert.deepEqual(JSON.parse(addition.terms), ["central venous catheter"]);
});

test("11. personal information never reaches Gemini", async () => {
  const sent = [];
  const { prisma } = memoryPrisma(draftGroups);
  await Suggestions.suggestForDocuments(
    document([
      {
        ...page13,
        pageContent: `${page13.pageContent}\n환자명: 홍길동 HD\n주민번호 900101-1234567\n담당 간호사 사번 2024123\n701호 병실 환자`,
      },
      page14,
      page15,
    ]),
    { prisma, llm: fakeGemini([], sent), logEvent: async () => null }
  );
  const text = sent.join("\n");
  for (const forbidden of [
    "041-589-6741",
    "2387",
    "교수님",
    "홍길동",
    "900101",
    "2024123",
    "701호",
  ])
    assert.equal(text.includes(forbidden), false, forbidden);
  assert.match(text, /기관지내시경BFS/);
  assert.match(text, /central venous catheter/);
  // repeated page headers are not sent
  assert.equal(text.includes("2026-04간호교육파트"), false);
});

test("11-1. only short title and term lines are sent, never the whole page", () => {
  const long = Array.from({ length: 40 }, (_, index) =>
    index % 2
      ? `설명 문장 ${index}번째 줄은 영어 없이 길게 이어지는 본문입니다 내용`
      : `절차 ${index}`
  ).join("\n");
  const { batches } = Suggestions.collectSnippets(
    [{ page: 1, pageContent: `기관지내시경 BFS\n${long}` }],
    { documentName: "검사.pdf" }
  );
  const lines = batches[0].text.split("\n");
  assert.ok(!lines[0].includes("검사"), "filenames are not needed by Gemini");
  assert.ok(lines.length <= 1 + 3 + 6);
});

test("12. existing groups are never changed by suggestions", async () => {
  const { prisma, db } = memoryPrisma(draftGroups);
  const before = JSON.stringify(db.groups);
  await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini([
      candidate(["기관지내시경", "Bronchofiberscopy"]),
      candidate(["혈액투석", "HD", "Hemodialysis"]),
      candidate(["중심정맥카테터", "CVC"], { pages: [15] }),
    ]),
    logEvent: async () => null,
  });
  assert.equal(JSON.stringify(db.groups.slice(0, 3)), before);
  assert.equal(
    db.writes.some(
      ([name, action]) => name === "groups" && action !== "create"
    ),
    false
  );
});

test("14. a 검토 필요 suggestion whose source document was deleted is kept as 출처 없음", async () => {
  const { prisma, db } = memoryPrisma(draftGroups, []);
  await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini([candidate(["중심정맥카테터", "CVC"], { pages: [15] })]),
    logEvent: async () => null,
  });
  const listed = await Synonyms.listGroups(prisma);
  const auto = listed.find((group) => group.source === "auto");
  assert.equal(auto.status, "needs_review");
  assert.equal(auto.suggestion.sourceMissing, true);
  // deleting the group closes the suggestion so it does not come back
  await Synonyms.deleteGroup(auto.id, prisma);
  assert.equal(db.suggestions[0].status, "dismissed");
  const again = await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini([candidate(["중심정맥카테터", "CVC"], { pages: [15] })]),
    logEvent: async () => null,
  });
  assert.equal(again.newGroups, 0);
  Synonyms.invalidate();
});

test("the switch SCHAT_SYNONYM_SUGGESTIONS=off stops automatic suggestions", async () => {
  process.env.SCHAT_SYNONYM_SUGGESTIONS = "off";
  try {
    assert.equal(
      await Suggestions.scheduleSynonymSuggestions([{ pageContent: "x" }]),
      null
    );
  } finally {
    delete process.env.SCHAT_SYNONYM_SUGGESTIONS;
  }
});

// ---- 한 번 실행, 순차 처리, 재시도, 텍스트 부족, 검증용 실행 ----------------------

test("manual CRUD finishes during a pending AI response and generation uses the latest groups", async () => {
  const { prisma, db } = memoryPrisma([
    { terms: ["임시", "temporary"] },
    { terms: ["삭제", "delete"] },
  ]);
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  const generation = Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: {
      getChatCompletion: async () => {
        started();
        await gate;
        return {
          textResponse: JSON.stringify({
            groups: [
              candidate(["기관지내시경", "BFS"]),
              candidate(["흉관", "chest tube"], { pages: [14] }),
            ],
          }),
        };
      },
    },
    logEvent: async () => null,
  });
  await waiting;
  let completed = false;
  const edits = (async () => {
    await Synonyms.createGroup({ terms: ["기관지내시경", "BFS"] }, prisma);
    await Synonyms.updateGroup(1, { terms: ["흉관", "chest tube"] }, prisma);
    await Synonyms.deleteGroup(2, prisma);
    completed = true;
  })();
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      completed,
      true,
      "manual CRUD must finish before the AI response"
    );
  } finally {
    release();
    await Promise.allSettled([edits, generation]);
  }
  await edits;
  const result = await generation;
  assert.equal(result.newGroups, 0);
  assert.equal(result.additions, 0);
  assert.equal(result.duplicates, 2);
  assert.equal(db.groups.length, 2);
  assert.equal(db.suggestions.length, 0);
});

test("generation rereads a rejection recorded while its AI response is pending", async () => {
  const { prisma, db } = memoryPrisma([{ terms: ["기관지내시경", "BFS"] }]);
  const proposal = await prisma.schat_synonym_suggestions.create({
    data: {
      type: "addition",
      group_id: 1,
      terms: '["Bronchofiberscopy"]',
      sources: "[]",
    },
  });
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  const generation = Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: {
      getChatCompletion: async () => {
        started();
        await gate;
        return {
          textResponse: JSON.stringify({
            groups: [candidate(["기관지내시경", "BFS", "Bronchofiberscopy"])],
          }),
        };
      },
    },
    logEvent: async () => null,
  });
  await waiting;
  let completed = false;
  const rejection = Suggestions.dismissAddition(proposal.id, prisma).then(
    () => {
      completed = true;
    }
  );
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      completed,
      true,
      "rejection must finish before the AI response"
    );
  } finally {
    release();
    await rejection;
    await generation;
  }
  const result = await generation;
  assert.equal(result.additions, 0);
  assert.equal(db.suggestions.length, 1);
  assert.equal(db.suggestions[0].status, "dismissed");
});

test("documents are processed one at a time, even when uploads overlap", async () => {
  const { prisma, db } = memoryPrisma([], ["doc-a", "doc-b"]);
  let inFlight = 0;
  let most = 0;
  const llm = {
    model: "gemini-test",
    getChatCompletion: async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return {
        textResponse: JSON.stringify({
          groups: [candidate(["기관지내시경", "BFS"])],
        }),
      };
    },
  };
  await Promise.all([
    Suggestions.suggestForDocuments(document(), {
      prisma,
      llm,
      logEvent: async () => null,
    }),
    Suggestions.suggestForDocuments(document(undefined, "doc-b"), {
      prisma,
      llm,
      logEvent: async () => null,
    }),
  ]);
  assert.equal(most, 1);
  assert.equal(db.groups.length, 1);
  assert.equal(db.suggestions.length, 1);
  assert.deepEqual(
    JSON.parse(db.suggestions[0].sources)
      .map((source) => source.documentId)
      .sort(),
    ["doc-a", "doc-b"]
  );
});

test("a rate limit is retried after waiting, then succeeds", async () => {
  const { prisma } = memoryPrisma(draftGroups);
  let calls = 0;
  const waits = [];
  const llm = {
    model: "gemini-test",
    getChatCompletion: async () => {
      calls += 1;
      if (calls <= 2) throw new Error("[429] Too Many Requests");
      return {
        textResponse: JSON.stringify({
          groups: [candidate(["중심정맥카테터", "CVC"], { pages: [15] })],
        }),
      };
    },
  };
  const result = await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm,
    logEvent: async () => null,
    sleep: async (ms) => waits.push(ms),
  });
  assert.deepEqual(waits, [15000, 30000]);
  assert.equal(result.retries, 2);
  assert.equal(result.newGroups, 1);
  assert.equal(result.rows[0].status, "created");
});

test("after the last retry the run stops instead of failing every document", async () => {
  const { prisma } = memoryPrisma(draftGroups, ["doc-a", "doc-b"]);
  let calls = 0;
  const llm = {
    model: "gemini-test",
    getChatCompletion: async () => {
      calls += 1;
      throw new Error("RESOURCE_EXHAUSTED: quota");
    },
  };
  const result = await Suggestions.suggestForDocuments(
    [...document(), ...document(undefined, "doc-b")],
    {
      prisma,
      llm,
      logEvent: async () => null,
      sleep: async () => null,
      logger: null,
    }
  );
  assert.equal(calls, 4); // 1 try + 3 retries, never endless
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ["failed", "stopped"]
  );
});

test("a document with almost no text is shown as 텍스트 부족 without calling Gemini", async () => {
  const { prisma, db } = memoryPrisma(draftGroups);
  const seen = [];
  const scanned = Array.from({ length: 15 }, (_, index) => ({
    page: index + 1,
    pageContent: index === 0 ? "중심정맥관 CVC 관리\n그림 1" : "그림",
  }));
  const result = await Suggestions.suggestForDocuments(
    [
      {
        documentId: "doc-a",
        documentName: "3-3. 실무지침서_중심정맥관.pdf",
        pages: scanned,
      },
    ],
    { prisma, llm: fakeGemini([], seen), logEvent: async () => null }
  );
  assert.equal(result.rows[0].status, "text_short");
  assert.equal(result.textShort, 1);
  assert.equal(seen.length, 0);
  assert.equal(db.suggestions.length, 0);
});

test("the run is recorded for the administrator screen", async () => {
  const { prisma } = memoryPrisma(draftGroups);
  await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini([
      candidate(["중심정맥카테터", "CVC"], { pages: [15] }),
      candidate(["기관지내시경", "BFS"]),
    ]),
    logEvent: async () => null,
    trigger: "backfill",
  });
  const [run] = await Suggestions.listRuns(prisma);
  assert.equal(run.trigger, "backfill");
  assert.equal(run.status, "done");
  assert.equal(run.summary.candidates, 2);
  assert.equal(run.summary.newGroups, 1);
  assert.equal(run.summary.duplicates, 1);
  assert.equal(run.documents[0].documentName, "검사 및 시술(26.04.07).pdf");
  assert.equal(run.documents[0].statusText, "후보 생성");
  // no page text is stored in the run record
  assert.equal(JSON.stringify(run).includes("기관지내시경BFS"), false);
});

test("a verification run is kept apart and can be removed exactly", async () => {
  const { prisma, db } = memoryPrisma(draftGroups, ["doc-a", "doc-b"]);
  // a real suggestion that existed before the verification run
  await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini([candidate(["중심정맥카테터", "CVC"], { pages: [15] })]),
    logEvent: async () => null,
  });
  const before = JSON.stringify({
    groups: db.groups,
    suggestions: db.suggestions,
  });
  const verification = await Suggestions.suggestForDocuments(
    document(undefined, "doc-b"),
    {
      prisma,
      llm: fakeGemini([
        candidate(["중심정맥카테터", "CVC"], { pages: [15] }),
        candidate(["흉수천자", "thoracentesis"], { pages: [14] }),
        candidate(["기관지내시경", "Bronchofiberscopy"]),
      ]),
      logEvent: async () => null,
      trigger: "backfill",
      test: true,
    }
  );
  // 흉수천자 is new, Bronchofiberscopy is an addition, CVC is a duplicate
  assert.equal(verification.newGroups, 1);
  assert.equal(verification.additions, 1);
  assert.equal(verification.duplicates, 1);
  const listed = await Synonyms.listGroups(prisma);
  const made = listed.filter((group) => group.suggestion?.test);
  assert.ok(made.every((group) => group.status === "needs_review"));
  // the existing real suggestion did not get the verification document as a source
  assert.deepEqual(
    JSON.parse(db.suggestions[0].sources).map((source) => source.documentId),
    ["doc-a"]
  );
  const removed = await Suggestions.removeTestRun(verification.runId, prisma);
  assert.ok(removed.suggestions >= 1);
  assert.equal(
    JSON.stringify({ groups: db.groups, suggestions: db.suggestions }),
    before
  );
  // a real run can never be removed this way
  await assert.rejects(
    () => Suggestions.removeTestRun(1, prisma),
    /검증용 실행만/
  );
});

test("verification cleanup refuses groups that an administrator approved or edited", async () => {
  for (const edit of [
    { status: "active" },
    { terms: JSON.stringify(["수정한표기", "EDITED"]) },
  ]) {
    const { prisma, db } = memoryPrisma([]);
    const run = await Suggestions.suggestForDocuments(document(), {
      prisma,
      test: true,
      logEvent: async () => null,
      llm: fakeGemini([candidate(["중심정맥카테터", "CVC"], { pages: [15] })]),
    });
    Object.assign(db.groups[0], edit);
    const before = JSON.stringify(db);
    await assert.rejects(
      Suggestions.removeTestRun(run.runId, prisma),
      /승인|수정/
    );
    assert.equal(JSON.stringify(db), before);
  }
});

test("a dry run stores nothing at all", async () => {
  const { prisma, db } = memoryPrisma(draftGroups);
  const result = await Suggestions.suggestForDocuments(document(), {
    prisma,
    llm: fakeGemini([candidate(["중심정맥카테터", "CVC"], { pages: [15] })]),
    logEvent: async () => null,
    dryRun: true,
  });
  assert.equal(result.newGroups, 1);
  assert.deepEqual(result.rows[0].preview.newGroups, [
    ["중심정맥카테터", "CVC"],
  ]);
  assert.equal(db.writes.length, 0);
});
