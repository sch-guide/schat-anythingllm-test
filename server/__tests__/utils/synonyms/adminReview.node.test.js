const test = require("node:test");
const assert = require("node:assert/strict");
const Synonyms = require("../../../utils/synonyms");
const Suggestions = require("../../../utils/synonyms/suggestions");

function memory(groups = [], proposals = []) {
  const db = {
    groups: groups.map((group, i) => ({
      id: i + 1,
      kind: "procedure",
      status: "active",
      source: "draft",
      note: null,
      ...group,
      terms: JSON.stringify(group.terms),
    })),
    proposals: proposals.map((row, i) => ({
      id: i + 1,
      group_id: 1,
      status: "pending",
      type: "group",
      sources: "[]",
      ...row,
      terms: JSON.stringify(row.terms || []),
    })),
  };
  const table = (key) => ({
    findMany: async ({ where = {} } = {}) =>
      db[key]
        .filter((row) => Object.entries(where).every(([k, v]) => row[k] === v))
        .map((row) => ({ ...row })),
    findUnique: async ({ where }) =>
      db[key].find((row) => row.id === where.id) || null,
    create: async ({ data }) => {
      const row = { id: db[key].length + 1, ...data };
      db[key].push(row);
      return { ...row };
    },
    update: async ({ where, data }) => {
      const row = db[key].find((row) => row.id === where.id);
      Object.assign(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }) =>
      db[key]
        .filter((row) => Object.entries(where).every(([k, v]) => row[k] === v))
        .forEach((row) => Object.assign(row, data)),
    delete: async ({ where }) => {
      db[key] = db[key].filter((row) => row.id !== where.id);
    },
  });
  const prisma = {
    schat_synonym_groups: table("groups"),
    schat_synonym_suggestions: table("proposals"),
    workspace_documents: { findMany: async () => [] },
  };
  prisma.$transaction = async (work) => {
    const before = structuredClone(db);
    try {
      return await work(prisma);
    } catch (error) {
      Object.assign(db, before);
      throw error;
    }
  };
  return { db, prisma };
}

test("manual creates trim terms, reject repeats and reject case-insensitive overlap", async () => {
  const { db, prisma } = memory([{ terms: ["카테터", "CATH"] }]);
  await assert.rejects(
    Synonyms.createGroup({ terms: [" cath ", "관"] }, prisma),
    /카테터 묶음에 이미 있어요/
  );
  await assert.rejects(
    Synonyms.createGroup({ terms: [" a ", "A", "b"] }, prisma),
    /같은 단어/
  );
  await assert.rejects(
    Synonyms.createGroup({ terms: ["하나"] }, prisma),
    /단어를 2개 이상 넣어 주세요/
  );
  const saved = await Synonyms.createGroup(
    { terms: [" 새말 ", "new word"] },
    prisma
  );
  assert.deepEqual(saved.terms, ["새말", "new word"]);
  assert.equal(db.groups.length, 2);
});

test("legacy overlaps survive status/category edits, but newly introduced overlap is refused", async () => {
  const { db, prisma } = memory([
    { terms: ["HD", "투석"], source: "auto" },
    { terms: ["hd", "혈액투석"] },
    { terms: ["관", "tube"] },
  ]);
  await Synonyms.updateGroup(1, { kind: "drug", status: "off" }, prisma);
  assert.equal(db.groups[0].source, "auto");
  assert.equal(db.groups[0].terms, '["HD","투석"]');
  await Synonyms.updateGroup(1, { terms: ["HD", "투석", "dialysis"] }, prisma);
  await assert.rejects(
    Synonyms.updateGroup(1, { terms: ["HD", "투석", "tube"] }, prisma),
    /관 묶음에 이미 있어요/
  );
  assert.equal(db.groups.length, 3);
});

test("concurrent overlapping creates admit only one group in a single server process", async () => {
  const { db, prisma } = memory();
  const results = await Promise.allSettled([
    Synonyms.createGroup({ terms: ["하나", "shared"] }, prisma),
    Synonyms.createGroup({ terms: ["둘", "SHARED"] }, prisma),
  ]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(db.groups.length, 1);
});

test("approve existing automatic group atomically; repeated approval creates no duplicate", async () => {
  const { db, prisma } = memory(
    [{ terms: ["생검", "biopsy"], source: "auto", status: "needs_review" }],
    [
      {
        terms: ["생검", "biopsy"],
        sources: '[{"documentId":"keep-private","pages":[3]}]',
      },
    ]
  );
  const results = await Promise.all([
    Suggestions.approveAddition(1, prisma),
    Suggestions.approveAddition(1, prisma),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(db.groups.length, 1);
  assert.equal(db.groups[0].status, "active");
  assert.equal(db.proposals[0].status, "approved");
  assert.equal(
    db.proposals[0].sources,
    '[{"documentId":"keep-private","pages":[3]}]'
  );
});

test("dismiss automatic group preserves it off; a manual draft cannot masquerade as an AI group", async () => {
  const { db, prisma } = memory(
    [{ terms: ["생검", "biopsy"], source: "auto", status: "needs_review" }],
    [{ terms: ["생검", "biopsy"] }]
  );
  assert.equal(await Suggestions.dismissAddition(1, prisma), true);
  assert.equal(db.proposals[0].status, "dismissed");
  assert.equal(db.groups.length, 1);
  assert.equal(db.groups[0].status, "off");
  assert.equal(await Suggestions.dismissAddition(1, prisma), false);
  const draft = memory(
    [{ terms: ["생검", "biopsy"], source: "draft", status: "needs_review" }],
    [{ terms: ["생검", "biopsy"] }]
  );
  assert.equal(await Suggestions.approveAddition(1, draft.prisma), null);
  assert.equal(draft.db.groups[0].status, "needs_review");
});

test("approving an addition validates overlap and opposite actions without changing off status", async () => {
  const { db, prisma } = memory(
    [{ terms: ["관", "tube"], status: "off" }, { terms: ["생검", "biopsy"] }],
    [
      { type: "addition", terms: ["BIOPSY"] },
      { type: "addition", terms: ["catheter"] },
      { type: "addition", terms: ["삽입", "제거"] },
    ]
  );
  await assert.rejects(
    Suggestions.approveAddition(1, prisma),
    /생검 묶음에 이미 있어요/
  );
  await assert.rejects(
    Suggestions.approveAddition(3, prisma),
    /서로 다른 시술/
  );
  assert.equal(db.proposals[0].status, "pending");
  await Suggestions.approveAddition(2, prisma);
  assert.equal(db.groups[0].status, "off");
  assert.deepEqual(JSON.parse(db.groups[0].terms), ["관", "tube", "catheter"]);
});

test("proposal status failure rolls group activation back", async () => {
  const { db, prisma } = memory(
    [{ terms: ["생검", "biopsy"], source: "auto", status: "needs_review" }],
    [{ terms: ["생검", "biopsy"] }]
  );
  prisma.schat_synonym_suggestions.update = async () => {
    throw new Error("synthetic write failure");
  };
  await assert.rejects(
    Suggestions.approveAddition(1, prisma),
    /synthetic write failure/
  );
  assert.equal(db.groups[0].status, "needs_review");
  assert.equal(db.proposals[0].status, "pending");
});

test("bulk applies only requested pending IDs, reports partial failure, and never reapplies", async () => {
  const { db, prisma } = memory(
    [{ terms: ["관", "tube"] }, { terms: ["생검", "biopsy"] }],
    [
      { type: "addition", terms: ["catheter"] },
      { type: "addition", terms: ["BIOPSY"] },
      { type: "addition", terms: ["line"] },
    ]
  );
  const result = await Suggestions.approveVisible([1, 1, 2], prisma);
  assert.deepEqual(result.approved, [1]);
  assert.equal(result.failed[0].id, 2);
  assert.match(result.failed[0].error, /생검 묶음에 이미 있어요/);
  assert.equal(db.proposals[2].status, "pending");
  const again = await Suggestions.approveVisible([1], prisma);
  assert.deepEqual(again.approved, []);
  assert.equal(
    JSON.parse(db.groups[0].terms).filter((term) => term === "catheter").length,
    1
  );
});

test("direct activation marks automatic group proposal approved in the same transaction", async () => {
  const { db, prisma } = memory(
    [{ terms: ["생검", "biopsy"], source: "auto", status: "needs_review" }],
    [{ terms: ["생검", "biopsy"] }]
  );
  await Synonyms.updateGroup(1, { status: "active" }, prisma);
  assert.equal(db.proposals[0].status, "approved");
});

test("admin source metadata exposes approved opaque references without private document IDs or paths", async () => {
  const { prisma } = memory(
    [{ terms: ["관", "tube"] }],
    [
      {
        terms: ["관", "tube"],
        sources:
          '[{"documentId":"private-id","documentName":"test.pdf","pages":[2]}]',
      },
    ]
  );
  prisma.workspace_documents.findMany = async () => [
    {
      metadata: JSON.stringify({
        document_id: "private-id",
        title: "test.pdf",
      }),
      workspace: { slug: "synthetic" },
    },
  ];
  const listed = await Suggestions.withSuggestions([{ id: 1 }], prisma, {
    originalMetadata: () => ({
      pdfRef: "a".repeat(43),
      originalPdfAvailable: true,
    }),
  });
  assert.deepEqual(listed[0].suggestion.sources, [
    {
      documentName: "test.pdf",
      pages: [2],
      missing: false,
      workspaceSlug: "synthetic",
      pdfRef: "a".repeat(43),
      originalPdfAvailable: true,
    },
  ]);
  assert.equal(JSON.stringify(listed).includes("private-id"), false);
});

test("rejecting a new automatic group prevents the same candidate from being planned again", async () => {
  const { db, prisma } = memory(
    [{ terms: ["생검", "biopsy"], source: "auto", status: "needs_review" }],
    [
      {
        terms: ["생검", "biopsy"],
        sources: '[{"documentId":"doc-a","pages":[3]}]',
      },
    ]
  );
  await Suggestions.dismissAddition(1, prisma);
  const plan = Suggestions.planSuggestions(
    [
      {
        terms: ["생검", "BIOPSY"],
        kind: "procedure",
        category: "시술",
        confidence: 0.9,
        pages: [3],
      },
    ],
    {
      groups: db.groups.map((row) => ({
        ...row,
        terms: JSON.parse(row.terms),
      })),
      suggestions: db.proposals.map((row) => ({
        ...row,
        terms: JSON.parse(row.terms),
        sources: JSON.parse(row.sources),
      })),
      source: { documentId: "doc-a", documentName: "test.pdf" },
    }
  );
  assert.equal(plan.newGroups.length, 0);
  assert.equal(plan.additions.length, 0);
  assert.equal(db.groups.length, 1);
});

test("a rejected hidden AI group permits a human replacement while preserving its tombstone", async () => {
  const { db, prisma } = memory(
    [{ terms: ["생검", "biopsy"], source: "auto", status: "off" }],
    [{ terms: ["생검", "biopsy"], status: "dismissed" }]
  );
  const saved = await Synonyms.createGroup(
    { terms: ["생검", "BIOPSY", "조직검사"] },
    prisma
  );
  assert.equal(saved.source, "admin");
  assert.equal(db.groups.length, 2);
  assert.equal(db.proposals[0].status, "dismissed");
  assert.equal(db.groups[0].status, "off");
});

test("normal off groups and dismissed additions remain subject to overlap checks", async () => {
  for (const proposals of [
    [],
    [{ type: "addition", terms: ["조직검사"], status: "dismissed" }],
    [{ terms: ["생검", "biopsy"], status: "approved" }],
  ]) {
    const { prisma } = memory(
      [{ terms: ["생검", "biopsy"], source: "auto", status: "off" }],
      proposals
    );
    await assert.rejects(
      Synonyms.createGroup({ terms: ["생검", "조직검사"] }, prisma),
      /생검 묶음에 이미 있어요/
    );
  }
});
