const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  collectImageOccurrences,
  planImageBackfill,
  applyDescriptionsToDocumentData,
  assertBackfillScope,
  assertApprovedBackfillCeilings,
  collectIndexedImageDescriptions,
  readCachedDescriptionState,
  readBackfillProgress,
  writeBackfillProgress,
  selectSingleImageDocumentId,
  splitIntoBatches,
  selectVectorId,
  parseArgs,
  processEmbeddingBatches,
  summarizeVectorChanges,
} = require("../../scripts/schatBackfillPdfImageDescriptions");

const key = (letter) => letter.repeat(64);

test("backfill plan describes only missing unique images and indexes every described image once", () => {
  const rows = [
    {
      id: 1,
      docId: "workspace-page-1",
      docpath: "folder/page-1.json",
      metadata: JSON.stringify({
        document_id: "target-document",
        page: 1,
        pdf_images: [
          { image_key: key("a"), description: "기존 설명" },
          { image_key: key("b"), description: "" },
        ],
      }),
    },
    {
      id: 2,
      docId: "workspace-page-2",
      docpath: "folder/page-2.json",
      metadata: JSON.stringify({
        document_id: "target-document",
        page: 2,
        pdf_images: [
          { image_key: key("b"), description: "" },
          { image_key: key("c"), description: "" },
        ],
      }),
    },
  ];

  const occurrences = collectImageOccurrences(rows, "target-document");
  const plan = planImageBackfill({
    occurrences,
    indexedDescriptions: new Map([[key("c"), "색인에서 복구한 설명"]]),
    cachedDescriptions: new Map(),
  });

  assert.deepEqual(plan.needsDescription, [key("b")]);
  assert.deepEqual(plan.needsIndex, [key("a"), key("b")]);
  assert.equal(plan.descriptions.get(key("a")), "기존 설명");
  assert.equal(plan.descriptions.get(key("c")), "색인에서 복구한 설명");
  assert.equal(occurrences.get(key("b")).rows.length, 2);
});

test("metadata update fills matching image descriptions without changing page text", () => {
  const original = {
    pageContent: "NRS, FPRS, FLACC",
    title: "간호실무지침.pdf",
    pdf_images: [
      { image_key: key("a"), description: "", storage_relative_path: "doc/a.png" },
      { image_key: key("b"), description: "기존 설명", storage_relative_path: "doc/b.png" },
    ],
  };

  const updated = applyDescriptionsToDocumentData(
    original,
    new Map([[key("a"), "NRS 0점부터 10점까지 선택하는 통증 평가 화면"]])
  );

  assert.equal(updated.pageContent, original.pageContent);
  assert.equal(updated.pdf_images[0].description, "NRS 0점부터 10점까지 선택하는 통증 평가 화면");
  assert.equal(updated.pdf_images[1].description, "기존 설명");
  assert.equal(original.pdf_images[0].description, "");
});

test("metadata update does not add image fields to pages without images", () => {
  const original = { pageContent: "본문만 있는 페이지", page: 50 };
  assert.deepEqual(
    applyDescriptionsToDocumentData(original, new Map([[key("a"), "설명"]])),
    original
  );
});

test("backfill reindexes an image when the stored vector text is stale", () => {
  const occurrences = collectImageOccurrences(
    [
      {
        id: 1,
        docId: "row-1",
        docpath: "folder/page.json",
        metadata: JSON.stringify({
          document_id: "target-document",
          pdf_images: [{ image_key: key("a"), description: "새 설명" }],
        }),
      },
    ],
    "target-document"
  );
  const plan = planImageBackfill({
    occurrences,
    indexedDescriptions: new Map([[key("a"), "오래된 설명"]]),
    cachedDescriptions: new Map(),
  });

  assert.deepEqual(plan.needsDescription, []);
  assert.deepEqual(plan.needsIndex, [key("a")]);
  assert.equal(plan.descriptions.get(key("a")), "새 설명");
});

test("backfill ignores other source documents and malformed image keys", () => {
  const occurrences = collectImageOccurrences(
    [
      {
        id: 1,
        docId: "row-1",
        docpath: "folder/page.json",
        metadata: JSON.stringify({
          document_id: "other-document",
          pdf_images: [{ image_key: key("a"), description: "" }],
        }),
      },
      {
        id: 2,
        docId: "row-2",
        docpath: "folder/page.json",
        metadata: JSON.stringify({
          document_id: "target-document",
          pdf_images: [{ image_key: "../../secret", description: "" }],
        }),
      },
    ],
    "target-document"
  );

  assert.equal(occurrences.size, 0);
});

test("backfill reuses an existing vector id instead of creating a duplicate", () => {
  assert.equal(
    selectVectorId({
      workspace: "workspace",
      docId: "page-row",
      imageKey: key("a"),
      existingVectorId: "existing-vector-id",
    }),
    "existing-vector-id"
  );
  assert.equal(
    selectVectorId({
      workspace: "workspace",
      docId: "page-row",
      imageKey: key("a"),
    }),
    selectVectorId({
      workspace: "workspace",
      docId: "page-row",
      imageKey: key("a"),
    })
  );
});

test("approved scope accepts a partially resumed run but rejects expansion", () => {
  const scope = {
    imageRowCount: 9,
    imageCount: 32,
    missingDescriptions: 6,
    missingVectors: 6,
    bodyVectorCount: 119,
    bodyVectorHash: key("f"),
    expectedRows: 9,
    expectedImages: 32,
    expectedMissing: 14,
    expectedMissingVectors: 14,
    expectedBodyVectors: 119,
    expectedBodyHash: key("f"),
  };
  assert.doesNotThrow(() => assertBackfillScope(scope));
  assert.throws(
    () => assertBackfillScope({ ...scope, missingDescriptions: 15 }),
    /unexpected_missing_count:15/
  );
  assert.throws(
    () => assertBackfillScope({ ...scope, imageRowCount: 10 }),
    /unexpected_image_row_count:10/
  );
});

test("approved backfill ceilings stop an expanded dataset before external calls", () => {
  assert.doesNotThrow(() =>
    assertApprovedBackfillCeilings({
      imageCount: 1172,
      missingDescriptions: 1138,
    })
  );
  assert.doesNotThrow(() =>
    assertApprovedBackfillCeilings({
      imageCount: 1172,
      missingDescriptions: 1100,
    })
  );
  assert.throws(
    () =>
      assertApprovedBackfillCeilings({
        imageCount: 1173,
        missingDescriptions: 1138,
      }),
    /approved_image_limit_exceeded/
  );
  assert.throws(
    () =>
      assertApprovedBackfillCeilings({
        imageCount: 1172,
        missingDescriptions: 1139,
      }),
    /approved_vision_limit_exceeded/
  );
});

test("terminal failed cache entries are resumed without another Vision call or vector", () => {
  const imageKey = key("d");
  const occurrences = collectImageOccurrences(
    [
      {
        id: 1,
        docId: "row-1",
        metadata: JSON.stringify({
          document_id: "target-document",
          pdf_images: [{ image_key: imageKey, description: "" }],
        }),
      },
    ],
    "target-document"
  );
  const plan = planImageBackfill({
    occurrences,
    indexedDescriptions: new Map(),
    cachedDescriptions: new Map(),
    terminalCacheKeys: new Set([imageKey]),
  });

  assert.deepEqual(plan.needsDescription, []);
  assert.deepEqual(plan.needsIndex, []);
  assert.deepEqual(plan.terminalWithoutDescription, [imageKey]);
});

test("existing duplicate image vectors reuse one canonical vector without throwing", () => {
  const imageKey = key("e");
  const indexed = collectIndexedImageDescriptions(
    {
      ids: ["vector-first", "vector-duplicate"],
      documents: ["동일 이미지 설명", "동일 이미지 설명"],
      metadatas: [
        { document_id: "target-document", image_key: imageKey },
        { document_id: "target-document", image_key: imageKey },
      ],
    },
    "target-document"
  );

  assert.equal(indexed.descriptions.get(imageKey), "동일 이미지 설명");
  assert.equal(indexed.vectorIds.get(imageKey), "vector-first");
  assert.deepEqual(indexed.duplicateVectorIds, ["vector-duplicate"]);
});

test("backfill work is split into stable bounded batches", () => {
  assert.deepEqual(splitIntoBatches(["a", "b", "c", "d", "e"], 2), [
    ["a", "b"],
    ["c", "d"],
    ["e"],
  ]);
});

test("backfill cache state reuses successes and treats empty or failed hashes as terminal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schat-backfill-cache-"));
  const cacheRoot = path.join(root, ".description-cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const successKey = key("1");
  const emptyKey = key("2");
  const failedKey = key("3");
  try {
    fs.writeFileSync(
      path.join(cacheRoot, `${successKey}.json`),
      JSON.stringify({ imageKey: successKey, description: "수혈 확인 화면" }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(cacheRoot, `${emptyKey}.json`),
      JSON.stringify({ imageKey: emptyKey, description: "", status: "empty" }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(cacheRoot, `${failedKey}.json`),
      JSON.stringify({ imageKey: failedKey, description: "", status: "failed" }),
      "utf8"
    );

    const state = readCachedDescriptionState(root, [
      successKey,
      emptyKey,
      failedKey,
    ]);
    assert.equal(state.descriptions.get(successKey), "수혈 확인 화면");
    assert.deepEqual([...state.terminalKeys].sort(), [
      successKey,
      emptyKey,
      failedKey,
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("batch progress is atomically persisted and can be resumed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schat-backfill-progress-"));
  try {
    writeBackfillProgress(root, "target-document", {
      completedBatches: 2,
      attempted: 75,
      success: 70,
      empty: 3,
      failed: 2,
    });
    assert.deepEqual(readBackfillProgress(root, "target-document"), {
      completedBatches: 2,
      attempted: 75,
      success: 70,
      empty: 3,
      failed: 2,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("automatic scope selects the only logical document containing PDF images", () => {
  const rows = [
    {
      metadata: JSON.stringify({
        document_id: "text-only-document",
        page: 1,
      }),
    },
    {
      metadata: JSON.stringify({
        document_id: "image-document",
        page: 2,
        pdf_images: [{ image_key: key("a"), description: "" }],
      }),
    },
  ];
  assert.equal(selectSingleImageDocumentId(rows), "image-document");
  assert.throws(
    () =>
      selectSingleImageDocumentId([
        ...rows,
        {
          metadata: JSON.stringify({
            document_id: "second-image-document",
            pdf_images: [{ image_key: key("b"), description: "" }],
          }),
        },
      ]),
    /image_document_scope_not_unique/
  );
});

test("embedding-only apply accepts zero Vision calls and rejects missing descriptions", () => {
  const args = parseArgs([
    "--workspace",
    "schat-test",
    "--auto-document",
    "--embedding-only",
    "--apply",
    "--max-calls",
    "0",
    "--expected-missing",
    "0",
    "--expected-missing-vectors",
    "2",
    "--expected-rows",
    "1",
    "--expected-images",
    "2",
    "--expected-body-vectors",
    "3",
    "--expected-body-hash",
    key("f"),
  ]);

  assert.equal(args.embeddingOnly, true);
  assert.equal(args.maxCalls, 0);
});

test("embedding batches are upserted and checkpointed before the next batch", async () => {
  const events = [];
  const items = ["a", "b", "c"].map((name) => ({
    imageKey: key(name),
    description: `description-${name}`,
    vectorId: `vector-${name}`,
    metadata: { image_key: key(name) },
  }));

  const result = await processEmbeddingBatches({
    items,
    batchSize: 2,
    embedBatch: async (descriptions) => {
      events.push(`embed:${descriptions.join(",")}`);
      return descriptions.map((_, index) => [index + 0.1]);
    },
    upsertBatch: async (batch, vectors) => {
      events.push(`upsert:${batch.map(({ vectorId }) => vectorId).join(",")}`);
      assert.equal(vectors.length, batch.length);
    },
    onBatchComplete: async (progress) => {
      events.push(`checkpoint:${progress.vectorsUpserted}`);
    },
  });

  assert.deepEqual(events, [
    "embed:description-a,description-b",
    "upsert:vector-a,vector-b",
    "checkpoint:2",
    "embed:description-c",
    "upsert:vector-c",
    "checkpoint:3",
  ]);
  assert.deepEqual(result, {
    completedBatches: 2,
    embeddingRequests: 2,
    vectorsUpserted: 3,
  });
});

test("embedding batch failure keeps earlier checkpoints and stops before later batches", async () => {
  const checkpoints = [];
  const items = ["a", "b", "c"].map((name) => ({
    imageKey: key(name),
    description: `description-${name}`,
    vectorId: `vector-${name}`,
    metadata: { image_key: key(name) },
  }));

  await assert.rejects(
    processEmbeddingBatches({
      items,
      batchSize: 1,
      embedBatch: async ([description]) => {
        if (description === "description-b") throw new Error("embedding failed");
        return [[0.1]];
      },
      upsertBatch: async () => undefined,
      onBatchComplete: async (progress) => checkpoints.push(progress),
    }),
    /embedding failed/
  );

  assert.deepEqual(checkpoints, [
    { completedBatches: 1, embeddingRequests: 1, vectorsUpserted: 1 },
  ]);
});

test("dry-run vector summary separates existing, new, and updated image vectors", () => {
  const indexed = {
    vectorIds: new Map([
      [key("a"), "vector-a"],
      [key("b"), "vector-b"],
    ]),
    duplicateVectorIds: ["duplicate-a"],
  };

  assert.deepEqual(
    summarizeVectorChanges({
      needsIndex: [key("b"), key("c"), key("d")],
      indexed,
    }),
    {
      existingImageDescriptionVectors: 3,
      existingUniqueImageVectors: 2,
      plannedVectorUpserts: 3,
      plannedNewVectors: 2,
      plannedVectorUpdates: 1,
    }
  );
});
