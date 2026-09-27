const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  persistPdfImages,
  imageIsUseful,
  extractImagesFromDocument,
  createGeminiImageDescriber,
  buildPageImageMetadata,
  readDescriptionCacheRecord,
  resolveDescriptionProcessingLimits,
} = require("../../../../processSingleFile/convert/asPDF/pdfImages");

test("small decorative PDF images are excluded", () => {
  assert.equal(imageIsUseful({ width: 32, height: 32 }), false);
  assert.equal(imageIsUseful({ width: 640, height: 360 }), true);
});

test("duplicate image hashes reuse one Gemini description", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schat-pdf-images-"));
  let calls = 0;
  const buffer = Buffer.from("same-png-content");

  try {
    const result = await persistPdfImages({
      documentId: "11111111-1111-4111-8111-111111111111",
      images: [
        { page: 2, index: 1, width: 640, height: 360, buffer },
        { page: 3, index: 1, width: 640, height: 360, buffer },
      ],
      storageRoot: root,
      describeImage: async () => {
        calls += 1;
        return "중심정맥관 연결 순서를 보여주는 절차도";
      },
      maxDescriptions: 10,
    });

    assert.equal(calls, 1);
    assert.equal(result.length, 2);
    assert.equal(result[0].description, result[1].description);
    assert.match(result[0].imageKey, /^[a-f0-9]{64}$/);
    assert.equal(fs.existsSync(result[0].absolutePath), true);
    assert.equal(result[0].absolutePath.includes("page-2-image-1"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("default description budget covers all 32 unique images in the current clinical PDF", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schat-pdf-images-"));
  let calls = 0;

  try {
    const images = Array.from({ length: 32 }, (_, index) => ({
      page: index + 1,
      index: 1,
      width: 640,
      height: 360,
      buffer: Buffer.from(`unique-clinical-image-${index + 1}`),
    }));
    const result = await persistPdfImages({
      documentId: "44444444-4444-4444-8444-444444444444",
      images,
      storageRoot: root,
      describeImage: async () => {
        calls += 1;
        return "화면에 보이는 임상 평가 항목";
      },
    });

    assert.equal(result.length, 32);
    assert.equal(calls, 32);
    assert.equal(result.every((image) => image.description.length > 0), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("description failure keeps the extracted image with an empty description", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schat-pdf-images-"));
  try {
    const [image] = await persistPdfImages({
      documentId: "22222222-2222-4222-8222-222222222222",
      images: [
        {
          page: 4,
          index: 1,
          width: 640,
          height: 360,
          buffer: Buffer.from("image-with-failed-description"),
        },
      ],
      storageRoot: root,
      describeImage: async () => {
        throw new Error("mock Gemini failure");
      },
    });

    assert.equal(image.description, "");
    assert.equal(fs.existsSync(image.absolutePath), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed and empty descriptions are recorded and never call Gemini again for the same hash", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schat-pdf-images-"));
  const cases = [
    {
      content: "failed-image",
      describe: async () => {
        throw new Error("temporary Gemini failure");
      },
      status: "failed",
    },
    {
      content: "empty-image",
      describe: async () => "",
      status: "empty",
    },
  ];

  try {
    for (const fixture of cases) {
      let calls = 0;
      const image = {
        page: 8,
        index: 1,
        width: 640,
        height: 360,
        buffer: Buffer.from(fixture.content),
      };
      const describeImage = async (buffer) => {
        calls += 1;
        return fixture.describe(buffer);
      };

      const [first] = await persistPdfImages({
        documentId: "55555555-5555-4555-8555-555555555555",
        images: [image],
        storageRoot: root,
        describeImage,
      });
      const [second] = await persistPdfImages({
        documentId: "55555555-5555-4555-8555-555555555555",
        images: [image],
        storageRoot: root,
        describeImage,
      });
      const cache = readDescriptionCacheRecord(
        path.join(root, ".description-cache", `${first.imageKey}.json`)
      );

      assert.equal(calls, 1);
      assert.equal(first.description, "");
      assert.equal(second.description, "");
      assert.equal(cache.status, fixture.status);
      assert.equal(cache.imageKey, first.imageKey);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("description processing reports completed batches and respects the per-run call cap", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schat-pdf-images-"));
  const batches = [];
  let calls = 0;

  try {
    const result = await persistPdfImages({
      documentId: "66666666-6666-4666-8666-666666666666",
      images: Array.from({ length: 5 }, (_, index) => ({
        page: index + 1,
        index: 1,
        width: 640,
        height: 360,
        buffer: Buffer.from(`batch-image-${index + 1}`),
      })),
      storageRoot: root,
      describeImage: async () => {
        calls += 1;
        return "검색 가능한 이미지 설명";
      },
      maxDescriptions: 3,
      batchSize: 2,
      onBatchComplete: (progress) => batches.push(progress),
    });

    assert.equal(calls, 3);
    assert.equal(result.filter(({ description }) => description).length, 3);
    assert.deepEqual(
      batches.map(({ attempted, completed }) => ({ attempted, completed })),
      [
        { attempted: 2, completed: 2 },
        { attempted: 3, completed: 3 },
      ]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("incremental upload limits use bounded defaults and accept positive environment overrides", () => {
  assert.deepEqual(resolveDescriptionProcessingLimits({}), {
    batchSize: 50,
    maxPerRun: 1150,
  });
  assert.deepEqual(
    resolveDescriptionProcessingLimits({
      SCHAT_PDF_IMAGE_DESCRIPTION_BATCH_SIZE: "25",
      SCHAT_PDF_IMAGE_DESCRIPTION_MAX_PER_RUN: "300",
    }),
    { batchSize: 25, maxPerRun: 300 }
  );
  assert.deepEqual(
    resolveDescriptionProcessingLimits({
      SCHAT_PDF_IMAGE_DESCRIPTION_BATCH_SIZE: "0",
      SCHAT_PDF_IMAGE_DESCRIPTION_MAX_PER_RUN: "not-a-number",
    }),
    { batchSize: 50, maxPerRun: 1150 }
  );
});

test("all useful raster images retain their PDF page and page-local order", async () => {
  const page = {
    getOperatorList: async () => ({
      fnArray: [11, 99, 11],
      argsArray: [["large-a"], ["not-an-image"], ["large-b"]],
    }),
    objs: {
      get: async (name) => ({ name, width: 640, height: 360, data: Buffer.alloc(4) }),
    },
  };
  const pdfDocument = {
    numPages: 1,
    getPage: async () => page,
  };

  const images = await extractImagesFromDocument({
    pdfDocument,
    validOps: [11],
    encodeImage: async (image) => Buffer.from(`png:${image.name}`),
  });

  assert.deepEqual(
    images.map(({ page, index, buffer }) => ({
      page,
      index,
      value: buffer.toString(),
    })),
    [
      { page: 1, index: 1, value: "png:large-a" },
      { page: 1, index: 2, value: "png:large-b" },
    ]
  );
});

test("Gemini image describer sends one image and returns a short text description", async () => {
  let request = null;
  const describe = createGeminiImageDescriber({
    model: "gemini-test-vision",
    client: {
      chat: {
        completions: {
          create: async (payload) => {
            request = payload;
            return {
              choices: [
                {
                  message: {
                    content: "수혈 전 환자 확인 순서를 보여주는 절차도",
                  },
                },
              ],
            };
          },
        },
      },
    },
  });

  const description = await describe(Buffer.from("png"));
  assert.equal(description, "수혈 전 환자 확인 순서를 보여주는 절차도");
  assert.equal(request.model, "gemini-test-vision");
  assert.equal(request.messages[0].content[1].type, "image_url");
  assert.match(request.messages[0].content[0].text, /도구명.*점수 범위/);
  assert.match(request.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
});

test("page metadata keeps searchable descriptions but omits absolute paths", () => {
  const metadata = buildPageImageMetadata([
    {
      imageKey: "a".repeat(64),
      page: 7,
      index: 1,
      description: "장비 연결 절차도",
      absolutePath: "C:\\private\\document-images\\image.png",
      storageRelativePath: "doc/page-7-image-1.png",
    },
  ]);

  assert.deepEqual(metadata, [
    {
      image_key: "a".repeat(64),
      page: 7,
      image_index: 1,
      description: "장비 연결 절차도",
      storage_relative_path: "doc/page-7-image-1.png",
    },
  ]);
  assert.equal(JSON.stringify(metadata).includes("C:\\private"), false);
});
