const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  addRows,
  applyDatabaseSwap,
  assertVectorPlan,
  assertKnownRepairScope,
  buildCanonicalSourceFingerprint,
  buildCollectionFingerprint,
  buildRepairStateFingerprint,
  buildVectorReusePlan,
  classifyDatabaseFingerprint,
  cleanupVerifiedPreSwapStaging,
  collectionLayoutForDatabaseState,
  createSqliteBackup,
  embedMissingRows,
  isSafeCollectionRoundTrip,
  parseArgs,
  publicErrorCode,
  reconcileCollectionLayout,
  restoreDatabase,
  runRepairPhase,
  summarizeCollectionRoundTrip,
} = require("../../scripts/schatRepairGuideRegistration");

test("repair script is dry-run by default and requires one explicit apply flag", () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(["--dry-run"]), { apply: false });
  assert.deepEqual(parseArgs(["--apply"]), { apply: true });
  assert.throws(
    () => parseArgs(["--dry-run", "--apply"]),
    /conflicting_mode/
  );
  assert.throws(() => parseArgs(["--force"]), /unknown_argument/);
});

test("known initial scope is repairable and the exact final scope is a no-op", () => {
  assert.equal(
    assertKnownRepairScope({
      workspaceDocuments: 100,
      sqliteVectors: 151,
      chromaVectors: 151,
      preservedDocuments: 82,
      preservedVectors: 91,
      canonicalDocuments: 9,
      canonicalVectors: 46,
      duplicateDocuments: 9,
      duplicateVectors: 14,
      missingCanonicalDocuments: 452,
    }),
    "repair"
  );

  assert.equal(
    assertKnownRepairScope({
      workspaceDocuments: 543,
      sqliteVectors: 717,
      chromaVectors: 717,
      preservedDocuments: 82,
      preservedVectors: 91,
      canonicalDocuments: 461,
      canonicalVectors: 626,
      duplicateDocuments: 0,
      duplicateVectors: 0,
      missingCanonicalDocuments: 0,
    }),
    "noop"
  );
});

test("unknown or partially repaired data is rejected before mutation", () => {
  assert.throws(
    () =>
      assertKnownRepairScope({
        workspaceDocuments: 101,
        sqliteVectors: 152,
        chromaVectors: 152,
        preservedDocuments: 82,
        preservedVectors: 91,
        canonicalDocuments: 10,
        canonicalVectors: 47,
        duplicateDocuments: 9,
        duplicateVectors: 14,
        missingCanonicalDocuments: 451,
      }),
    /unexpected_repair_scope/
  );
});

test("staging reuses only exact canonical vectors and embeds the remainder", () => {
  const desired = [
    {
      docId: "page-1",
      document: "same body",
      metadata: { document_id: "canonical", page: 1 },
    },
    {
      docId: "page-1",
      document: "new image description",
      metadata: {
        document_id: "canonical",
        page: 1,
        content_type: "image_description",
        image_key: "a".repeat(64),
      },
    },
  ];
  const existing = [
    {
      id: "existing-body",
      document: "same body",
      metadata: { document_id: "canonical", page: 1 },
      embedding: [0.1, 0.2],
    },
    {
      id: "wrong-image",
      document: "old image description",
      metadata: {
        document_id: "canonical",
        page: 1,
        content_type: "image_description",
        image_key: "a".repeat(64),
      },
      embedding: [0.3, 0.4],
    },
  ];

  const plan = buildVectorReusePlan(desired, existing);

  assert.equal(plan.reused.length, 1);
  assert.equal(plan.reused[0].id, "existing-body");
  assert.equal(plan.missing.length, 1);
  assert.equal(plan.missing[0].metadata.content_type, "image_description");
});

test("repair state fingerprint detects concurrent document or vector changes", () => {
  const state = {
    workspaceRecords: [
      { id: 2, docId: "doc-b", docpath: "b.json", metadata: "b" },
      { id: 1, docId: "doc-a", docpath: "a.json", metadata: "a" },
    ],
    mappings: [
      { id: 2, docId: "doc-b", vectorId: "vector-b" },
      { id: 1, docId: "doc-a", vectorId: "vector-a" },
    ],
    liveRows: [
      { id: "vector-b", document: "b", metadata: { page: 2 } },
      { id: "vector-a", document: "a", metadata: { page: 1 } },
    ],
  };
  const fingerprint = buildRepairStateFingerprint(state);

  assert.equal(
    fingerprint,
    buildRepairStateFingerprint({
      workspaceRecords: [...state.workspaceRecords].reverse(),
      mappings: [...state.mappings].reverse(),
      liveRows: [...state.liveRows].reverse(),
    })
  );
  assert.notEqual(
    fingerprint,
    buildRepairStateFingerprint({
      ...state,
      mappings: [
        ...state.mappings,
        { id: 3, docId: "doc-c", vectorId: "vector-c" },
      ],
    })
  );
});

test("approved vector plan enforces the exact reused and missing type mix", () => {
  const body = (count, prefix) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-body-${index}`,
      document: `${prefix} body ${index}`,
      metadata: { page: index + 1 },
      embedding: [index + 0.1],
    }));
  const images = (count, prefix) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-image-${index}`,
      document: `${prefix} image ${index}`,
      metadata: {
        page: index + 1,
        content_type: "image_description",
        image_key: String(index).padStart(64, "0"),
      },
      embedding: [index + 0.2],
    }));
  const reused = [...body(14, "reused"), ...images(32, "reused")];
  const missing = [...body(549, "missing"), ...images(31, "missing")];
  const desired = [...reused, ...missing];

  assert.doesNotThrow(() => assertVectorPlan(desired, { reused, missing }));
  const wrongReused = [...body(15, "wrong"), ...images(31, "wrong")];
  const wrongMissing = [...body(548, "wrong-missing"), ...images(32, "wrong-missing")];
  assert.throws(
    () =>
      assertVectorPlan([...wrongReused, ...wrongMissing], {
        reused: wrongReused,
        missing: wrongMissing,
      }),
    /unexpected_reused_vector_mix/
  );
});

test("embedding work is sequential, at most four inputs, model scoped, and retry-free", async () => {
  const originalKey = process.env.GEMINI_EMBEDDING_API_KEY;
  const requests = [];
  const clients = [];
  const progress = [];
  const delays = [];
  class MockOpenAI {
    constructor(options) {
      clients.push(options);
      this.embeddings = {
        create: async (request) => {
          requests.push(request);
          return {
            data: request.input.map((_, index) => ({
              index,
              embedding: [requests.length, index],
            })),
          };
        },
      };
    }
  }
  process.env.GEMINI_EMBEDDING_API_KEY = "test-only-key";
  try {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      document: `row ${index}`,
      metadata: { page: index + 1 },
    }));
    const embedded = await embedMissingRows(rows, MockOpenAI, {
      onProgress: (value) => progress.push(value),
      sleep: async (delayMs) => delays.push(delayMs),
    });
    assert.equal(embedded.length, 9);
    assert.deepEqual(
      requests.map(({ input }) => input.length),
      [4, 4, 1]
    );
    assert.ok(requests.every(({ model }) => model === "gemini-embedding-2"));
    assert.equal(clients[0].maxRetries, 0);
    assert.deepEqual(progress, [
      { completedBatches: 1, totalBatches: 3 },
      { completedBatches: 2, totalBatches: 3 },
      { completedBatches: 3, totalBatches: 3 },
    ]);
    assert.deepEqual(delays, [2000, 2000]);
  } finally {
    if (originalKey === undefined)
      delete process.env.GEMINI_EMBEDDING_API_KEY;
    else process.env.GEMINI_EMBEDDING_API_KEY = originalKey;
  }
});

test("Chroma writes use conservative batches of 25 without losing rows", async () => {
  const batches = [];
  const collection = {
    async add(payload) {
      batches.push(payload);
    },
  };
  const rows = Array.from({ length: 53 }, (_, index) => ({
    id: `row-${index}`,
    document: `document ${index}`,
    metadata: { page: index + 1 },
    embedding: [index, index + 0.5],
  }));

  await addRows(collection, rows);

  assert.deepEqual(
    batches.map(({ ids }) => ids.length),
    [25, 25, 3]
  );
  assert.deepEqual(batches.flatMap(({ ids }) => ids), rows.map(({ id }) => id));
  assert.ok(
    batches.every(
      ({ ids, embeddings, metadatas, documents }) =>
        ids.length === embeddings.length &&
        ids.length === metadatas.length &&
        ids.length === documents.length
    )
  );
});

test("collection fingerprint matches a Chroma Float32 embedding round-trip", () => {
  const fullPrecision = [
    0.123456789012345,
    -0.987654321098765,
    1 / 3,
    Number.MIN_VALUE,
  ];
  const row = {
    id: "vector-1",
    document: "same document",
    metadata: { page: 1 },
  };

  assert.equal(
    buildCollectionFingerprint([{ ...row, embedding: fullPrecision }]),
    buildCollectionFingerprint([
      { ...row, embedding: fullPrecision.map((value) => Math.fround(value)) },
    ])
  );
  assert.throws(
    () => buildCollectionFingerprint([{ ...row, embedding: [0, NaN] }]),
    /collection_embedding_invalid/
  );
  assert.throws(
    () => buildCollectionFingerprint([{ ...row, embedding: [Infinity] }]),
    /collection_embedding_invalid/
  );
});

test("collection verification accepts decimal precision only, not cosine-only similarity", () => {
  const expectedEmbedding = [
    0.1234567890123456,
    -0.9876543210987654,
  ];
  const storedEmbedding = [0.12345679, -0.9876543];
  const base = {
    id: "internal-vector-id",
    document: "hospital source text",
    metadata: { page: 117, internal_path: "private" },
  };
  const expected = [{ ...base, embedding: expectedEmbedding }];
  const stored = [{ ...base, embedding: storedEmbedding }];

  const precisionSummary = summarizeCollectionRoundTrip(expected, stored);
  assert.equal(precisionSummary.embeddingExactMismatches, 1);
  assert.equal(precisionSummary.embeddingAllCloseEquivalent, 1);
  assert.equal(precisionSummary.embeddingCosineEquivalent, 1);
  assert.equal(precisionSummary.embeddingValueMismatches, 0);
  assert.equal(isSafeCollectionRoundTrip(precisionSummary), true);

  const scaled = [
    { ...base, embedding: expectedEmbedding.map((value) => value * 2) },
  ];
  const scaledSummary = summarizeCollectionRoundTrip(expected, scaled);
  assert.equal(scaledSummary.embeddingCosineEquivalent, 1);
  assert.equal(scaledSummary.embeddingAllCloseEquivalent, 0);
  assert.equal(scaledSummary.embeddingValueMismatches, 1);
  assert.equal(isSafeCollectionRoundTrip(scaledSummary), false);

  const changed = [
    { ...base, embedding: [expectedEmbedding[0] + 0.01, expectedEmbedding[1]] },
  ];
  const changedSummary = summarizeCollectionRoundTrip(expected, changed);
  assert.notEqual(
    buildCollectionFingerprint(expected),
    buildCollectionFingerprint(changed)
  );
  assert.equal(changedSummary.embeddingAllCloseEquivalent, 0);
  assert.equal(changedSummary.embeddingValueMismatches, 1);
  assert.equal(isSafeCollectionRoundTrip(changedSummary), false);
});

test("collection mismatch diagnostic exposes counts only", () => {
  const expected = [
    {
      id: "secret-internal-id",
      document: "confidential hospital sentence",
      metadata: { internal_path: "C:/private/hospital.pdf", page: 1 },
      embedding: [1, 0],
    },
    {
      id: "missing-secret-id",
      document: "missing confidential sentence",
      metadata: { page: 3 },
      embedding: [1, 0],
    },
  ];
  const stored = [
    {
      id: "secret-internal-id",
      document: "different confidential sentence",
      metadata: { internal_path: "C:/another/private.pdf", page: 2 },
      embedding: [0, 1],
    },
    {
      id: "different-secret-id",
      document: "unexpected confidential sentence",
      metadata: { page: 4 },
      embedding: [1, 0],
    },
  ];
  const diagnostic = summarizeCollectionRoundTrip(expected, stored);
  const serialized = JSON.stringify(diagnostic);

  assert.equal(diagnostic.expectedRows, 2);
  assert.equal(diagnostic.storedRows, 2);
  assert.equal(diagnostic.missingRows, 1);
  assert.equal(diagnostic.unexpectedRows, 1);
  assert.equal(diagnostic.documentMismatches, 1);
  assert.equal(diagnostic.metadataMismatches, 1);
  assert.equal(diagnostic.embeddingValueMismatches, 1);
  for (const secret of [
    "secret-internal-id",
    "different-secret-id",
    "missing-secret-id",
    "confidential",
    "internal_path",
    "private",
  ]) assert.equal(serialized.includes(secret), false);
});

test("phase wrapper replaces arbitrary upstream details with one fixed code", async () => {
  await assert.rejects(
    runRepairPhase("repair_phase_chroma_add_failed", async () => {
      throw new Error("private path and source text from upstream");
    }),
    (error) => error.message === "repair_phase_chroma_add_failed"
  );
  assert.equal(
    await runRepairPhase("repair_phase_unused", async () => 42),
    42
  );
});

function fakeChromaClient(initialCollections, failAfterRename) {
  const collections = new Map(Object.entries(initialCollections));
  let failed = false;
  return {
    collections,
    async listCollections() {
      return [...collections.keys()].map((name) => ({ name }));
    },
    async getCollection({ name }) {
      if (!collections.has(name)) throw new Error("not found");
      return {
        async get() {
          const rows = collections.get(name);
          return {
            ids: rows.map(({ id }) => id),
            documents: rows.map(({ document }) => document),
            metadatas: rows.map(({ metadata }) => metadata),
            embeddings: rows.map(({ embedding }) => embedding),
          };
        },
        async modify({ name: nextName }) {
          if (collections.has(nextName)) throw new Error("already exists");
          const rows = collections.get(name);
          collections.delete(name);
          collections.set(nextName, rows);
          if (!failed && failAfterRename?.(name, nextName)) {
            failed = true;
            throw new Error("simulated timeout after successful rename");
          }
        },
      };
    },
    async deleteCollection({ name }) {
      if (!collections.has(name)) throw new Error("not found");
      collections.delete(name);
    },
  };
}

test("ambiguous rename timeout is inspected and both collection layouts reconcile", async () => {
  const names = {
    live: "workspace",
    staging: "workspace-reindex-run001",
    previous: "workspace-before-run001",
  };
  const oldRows = [
    { id: "old", document: "old", metadata: { page: 1 }, embedding: [1] },
  ];
  const newRows = [
    { id: "new", document: "new", metadata: { page: 1 }, embedding: [2] },
  ];
  const fingerprints = {
    oldFingerprint: buildCollectionFingerprint(oldRows),
    newFingerprint: buildCollectionFingerprint(newRows),
  };
  const client = fakeChromaClient(
    { [names.live]: oldRows, [names.staging]: newRows },
    (from, to) => from === names.staging && to === names.live
  );

  await reconcileCollectionLayout(client, names, fingerprints, "new-live");
  assert.equal(
    buildCollectionFingerprint(client.collections.get(names.live)),
    fingerprints.newFingerprint
  );
  assert.equal(
    buildCollectionFingerprint(client.collections.get(names.previous)),
    fingerprints.oldFingerprint
  );

  await reconcileCollectionLayout(client, names, fingerprints, "old-live");
  assert.equal(
    buildCollectionFingerprint(client.collections.get(names.live)),
    fingerprints.oldFingerprint
  );
  assert.equal(
    buildCollectionFingerprint(client.collections.get(names.staging)),
    fingerprints.newFingerprint
  );
});

test("database state exclusively selects the matching collection layout", () => {
  assert.equal(
    classifyDatabaseFingerprint("old", {
      initialFingerprint: "old",
      desiredFingerprint: "new",
    }),
    "initial"
  );
  assert.equal(collectionLayoutForDatabaseState("initial"), "old-live");
  assert.equal(collectionLayoutForDatabaseState("desired"), "new-live");
  assert.throws(
    () => collectionLayoutForDatabaseState("unknown"),
    /repair_database_state_unknown/
  );
});

test("pre-swap capacity failure deletes only its staging after old live fingerprint verification", async () => {
  const names = {
    live: "workspace",
    staging: "workspace-reindex-run001",
    previous: "workspace-before-run001",
  };
  const oldRows = [
    { id: "old", document: "old", metadata: { page: 1 }, embedding: [1] },
  ];
  const partialRows = [
    {
      id: "partial",
      document: "partial",
      metadata: { page: 2 },
      embedding: [2],
    },
  ];
  const client = fakeChromaClient({
    [names.live]: oldRows,
    [names.staging]: partialRows,
  });

  await cleanupVerifiedPreSwapStaging(
    client,
    names,
    buildCollectionFingerprint(oldRows)
  );
  assert.deepEqual([...client.collections.keys()], [names.live]);

  const unsafeClient = fakeChromaClient({
    [names.live]: oldRows,
    [names.staging]: partialRows,
  });
  await assert.rejects(
    cleanupVerifiedPreSwapStaging(unsafeClient, names, "wrong-fingerprint"),
    /staging_cleanup_live_mismatch/
  );
  assert.ok(unsafeClient.collections.has(names.staging));
});

test("database replacement and restore each execute as one transaction", async () => {
  const transactions = [];
  const operation = (kind) => (args) => ({ kind, args });
  const prisma = {
    document_vectors: {
      deleteMany: operation("vector-delete"),
      create: operation("vector-create"),
    },
    workspace_documents: {
      deleteMany: operation("document-delete"),
      update: operation("document-update"),
      create: operation("document-create"),
    },
    async $transaction(operations) {
      transactions.push(operations);
    },
  };
  const original = {
    id: 1,
    docId: "canonical-page",
    filename: "old.json",
    docpath: "custom-documents/old.json",
    workspaceId: 1,
    metadata: "{}",
    pinned: false,
    watched: false,
    createdAt: new Date(0),
    lastUpdatedAt: new Date(0),
  };
  const localRecord = {
    filename: "new.json",
    docpath: "custom-documents/new.json",
    sourceData: { page: 1, title: "guide" },
  };
  const missingRecord = {
    filename: "missing.json",
    docpath: "custom-documents/missing.json",
    sourceData: { page: 2, title: "guide" },
  };

  await applyDatabaseSwap({
    prisma,
    workspaceId: 1,
    canonicalExisting: [{ id: 1, localRecord }],
    duplicateRows: [{ id: 2 }],
    missingRows: [missingRecord],
    docIdsByPath: new Map([[missingRecord.docpath, "missing-page"]]),
    canonicalMappings: [
      { docId: "canonical-page", vectorId: "canonical-vector" },
    ],
    allExistingGuideDocIds: ["canonical-page", "duplicate-page"],
  });
  assert.equal(transactions.length, 1);
  assert.deepEqual(
    transactions[0].map(({ kind }) => kind),
    [
      "vector-delete",
      "document-delete",
      "document-update",
      "document-create",
      "vector-create",
    ]
  );

  await restoreDatabase({
    prisma,
    canonicalExistingOriginal: [original],
    duplicateOriginal: [{ ...original, id: 2, docId: "duplicate-page" }],
    originalGuideMappings: [
      {
        id: 1,
        docId: "canonical-page",
        vectorId: "old-vector",
        createdAt: new Date(0),
        lastUpdatedAt: new Date(0),
      },
    ],
    newGuideDocIds: ["canonical-page", "missing-page"],
    missingDocIds: ["missing-page"],
  });
  assert.equal(transactions.length, 2);
  assert.deepEqual(
    transactions[1].map(({ kind }) => kind),
    [
      "vector-delete",
      "document-delete",
      "document-update",
      "document-create",
      "vector-create",
    ]
  );
});

test("public failures redact arbitrary paths, upstream messages, and arguments", () => {
  assert.equal(
    publicErrorCode(new Error("C:\\private\\hospital\\guide.json failed")),
    "repair_failed"
  );
  assert.equal(
    publicErrorCode(new Error("upstream returned source text")),
    "repair_failed"
  );
  assert.equal(publicErrorCode(new Error("unknown_argument")), "invalid_arguments");
  assert.equal(
    publicErrorCode(new Error("repair_phase_chroma_add_failed")),
    "repair_phase_chroma_add_failed"
  );
  for (const phase of [
    "repair_phase_staging_count_failed",
    "repair_phase_staging_mapping_failed",
    "repair_phase_staging_fingerprint_failed",
  ]) assert.equal(publicErrorCode(new Error(phase)), phase);
});

test("canonical local source fingerprint changes when its JSON payload changes", () => {
  const first = [
    {
      docpath: "custom-documents/page-1.json",
      sourceData: { page: 1, pageContent: "first" },
    },
  ];
  assert.notEqual(
    buildCanonicalSourceFingerprint(first),
    buildCanonicalSourceFingerprint([
      {
        ...first[0],
        sourceData: { page: 1, pageContent: "changed" },
      },
    ])
  );
});

test("SQLite backup uses VACUUM INTO a non-empty local snapshot", async () => {
  const storageRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "schat-guide-repair-test-")
  );
  const prisma = {
    async $executeRawUnsafe(sql) {
      const match = /^VACUUM INTO '(.+)'$/.exec(sql);
      assert.ok(match);
      fs.writeFileSync(match[1].replace(/''/g, "'"), "sqlite snapshot");
    },
  };
  try {
    const backupPath = await createSqliteBackup(
      prisma,
      storageRoot,
      "run001"
    );
    assert.equal(path.dirname(backupPath), path.join(storageRoot, "exports"));
    assert.ok(fs.statSync(backupPath).size > 0);
  } finally {
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});
