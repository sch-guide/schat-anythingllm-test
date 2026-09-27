const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const IMAGE_KEY_PATTERN = /^[a-f0-9]{64}$/;
const DOCUMENT_ID_PATTERN = /^[a-f0-9-]{16,64}$/i;
const DEFAULT_MAX_IMAGE_DESCRIPTIONS = 50;
const DEFAULT_IMAGE_DESCRIPTION_BATCH_SIZE = 50;
const DEFAULT_IMAGE_DESCRIPTION_MAX_PER_RUN = 1150;
const TERMINAL_CACHE_STATUSES = new Set(["success", "empty", "failed"]);

function imageIsUseful({ width = 0, height = 0 } = {}) {
  return width >= 96 && height >= 96 && width * height >= 20_000;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveDescriptionProcessingLimits(env = process.env) {
  return {
    batchSize: positiveInteger(
      env.SCHAT_PDF_IMAGE_DESCRIPTION_BATCH_SIZE,
      DEFAULT_IMAGE_DESCRIPTION_BATCH_SIZE
    ),
    maxPerRun: positiveInteger(
      env.SCHAT_PDF_IMAGE_DESCRIPTION_MAX_PER_RUN,
      DEFAULT_IMAGE_DESCRIPTION_MAX_PER_RUN
    ),
  };
}

function safeDocumentId(documentId = "") {
  const value = String(documentId).trim();
  if (!DOCUMENT_ID_PATTERN.test(value)) throw new Error("invalid_document_id");
  return value;
}

function imageHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function toRawImage(image = {}) {
  const width = Number(image.width);
  const height = Number(image.height);
  if (!width || !height || !image.data) return null;
  const data = Buffer.from(image.data);
  const packedRowLength = Math.ceil(width / 8) * height;
  if (image.kind === 1 || data.length === packedRowLength) {
    const unpacked = Buffer.alloc(width * height);
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const byte = data[y * rowBytes + (x >> 3)];
        unpacked[y * width + x] = (byte >> (7 - (x & 7))) & 1 ? 255 : 0;
      }
    }
    return { data: unpacked, width, height, channels: 1 };
  }
  const channels = data.length / width / height;
  if (![1, 2, 3, 4].includes(channels)) return null;
  return { data, width, height, channels };
}

async function encodePdfImage(image) {
  const raw = toRawImage(image);
  if (!raw) return null;
  const sharp = (await import("sharp")).default;
  return sharp(raw.data, {
    raw: {
      width: raw.width,
      height: raw.height,
      channels: raw.channels,
    },
  })
    .png()
    .toBuffer();
}

async function extractImagesFromDocument({
  pdfDocument,
  validOps = [],
  encodeImage = encodePdfImage,
}) {
  const extracted = [];
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const operators = await page.getOperatorList();
    let pageImageIndex = 0;
    for (let index = 0; index < operators.fnArray.length; index += 1) {
      if (!validOps.includes(operators.fnArray[index])) continue;
      try {
        const objectName = operators.argsArray[index]?.[0];
        const image = await page.objs.get(objectName);
        if (!imageIsUseful(image)) continue;
        const buffer = await encodeImage(image);
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) continue;
        pageImageIndex += 1;
        extracted.push({
          page: pageNumber,
          index: pageImageIndex,
          width: image.width,
          height: image.height,
          buffer,
        });
      } catch {
        continue;
      }
    }
  }
  return extracted;
}

async function extractPdfRasterImages(filePath) {
  const pdfjs = await import("pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(filePath)),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdfDocument = loadingTask?.promise
    ? await loadingTask.promise
    : await loadingTask;
  return extractImagesFromDocument({
    pdfDocument,
    validOps: [
      pdfjs.OPS.paintJpegXObject,
      pdfjs.OPS.paintImageXObject,
      pdfjs.OPS.paintInlineImageXObject,
    ].filter((value) => Number.isInteger(value)),
  });
}

function sanitizeDescription(value = "") {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function createGeminiImageDescriber({ client, model } = {}) {
  let geminiClient = client;
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("gemini_api_key_missing");
    const { OpenAI } = require("openai");
    geminiClient = new OpenAI({
      apiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      maxRetries: 0,
    });
  }
  const selectedModel =
    model ||
    process.env.SCHAT_PDF_IMAGE_DESCRIPTION_MODEL ||
    process.env.GEMINI_LLM_MODEL_PREF ||
    "gemini-2.0-flash-lite";

  return async (buffer) => {
    const response = await geminiClient.chat.completions.create({
      model: selectedModel,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "이 이미지를 병원 지침 검색에 도움이 되도록 한국어 1~2문장으로 설명하세요.",
                "이미지에 실제로 보이는 표, 절차, 장비, 글자만 설명하세요.",
                "평가척도나 표라면 보이는 도구명, 점수 범위와 단계·항목명을 정확히 포함하세요.",
                "의료적 의미를 추측하거나 보이지 않는 사실을 추가하지 마세요.",
                "설명문만 출력하세요.",
              ].join(" "),
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${buffer.toString("base64")}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    });
    return sanitizeDescription(response?.choices?.[0]?.message?.content || "");
  };
}

function readDescriptionCacheRecord(cachePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const description =
      typeof parsed.description === "string" ? parsed.description.trim() : "";
    const status = TERMINAL_CACHE_STATUSES.has(parsed.status)
      ? parsed.status
      : description
        ? "success"
        : null;
    if (!status) return null;
    return {
      imageKey: String(parsed.imageKey || ""),
      description,
      status,
    };
  } catch {
    return null;
  }
}

function writeDescriptionCacheRecord(cachePath, record = {}) {
  const imageKey = String(record.imageKey || "");
  const description =
    typeof record.description === "string" ? record.description.trim() : "";
  const status = TERMINAL_CACHE_STATUSES.has(record.status)
    ? record.status
    : description
      ? "success"
      : "empty";
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    JSON.stringify({ imageKey, description, status }),
    "utf8"
  );
  fs.renameSync(temporaryPath, cachePath);
}

async function persistPdfImages({
  documentId,
  images = [],
  storageRoot,
  describeImage = null,
  maxDescriptions = DEFAULT_MAX_IMAGE_DESCRIPTIONS,
  batchSize = DEFAULT_IMAGE_DESCRIPTION_BATCH_SIZE,
  onBatchComplete = null,
}) {
  const safeId = safeDocumentId(documentId);
  const documentFolder = path.resolve(storageRoot, safeId);
  const cacheFolder = path.resolve(storageRoot, ".description-cache");
  fs.mkdirSync(documentFolder, { recursive: true });
  fs.mkdirSync(cacheFolder, { recursive: true });

  const descriptionRecords = new Map();
  let generatedDescriptions = 0;
  let lastReportedAttempt = 0;
  const persisted = [];
  const safeBatchSize = Math.max(1, Number(batchSize) || DEFAULT_IMAGE_DESCRIPTION_BATCH_SIZE);

  const reportBatch = async () => {
    if (
      typeof onBatchComplete !== "function" ||
      generatedDescriptions === lastReportedAttempt
    )
      return;
    lastReportedAttempt = generatedDescriptions;
    await onBatchComplete({
      attempted: generatedDescriptions,
      completed: generatedDescriptions,
    });
  };

  for (const image of images) {
    if (!Buffer.isBuffer(image?.buffer) || !imageIsUseful(image)) continue;
    const imageKey = imageHash(image.buffer);
    const page = Number.isInteger(image.page) && image.page > 0 ? image.page : 1;
    const index = Number.isInteger(image.index) && image.index > 0 ? image.index : 1;
    const filename = `page-${page}-image-${index}-${imageKey.slice(0, 12)}.png`;
    const absolutePath = path.resolve(documentFolder, filename);
    fs.writeFileSync(absolutePath, image.buffer);

    let cacheRecord = descriptionRecords.get(imageKey);
    if (cacheRecord === undefined) {
      const cachePath = path.resolve(cacheFolder, `${imageKey}.json`);
      cacheRecord = readDescriptionCacheRecord(cachePath);
      if (
        !cacheRecord &&
        typeof describeImage === "function" &&
        generatedDescriptions < Math.max(0, maxDescriptions)
      ) {
        generatedDescriptions += 1;
        try {
          const generated = await describeImage(image.buffer);
          const description =
            typeof generated === "string" ? generated.trim() : "";
          cacheRecord = {
            imageKey,
            description,
            status: description ? "success" : "empty",
          };
        } catch {
          cacheRecord = { imageKey, description: "", status: "failed" };
        }
        writeDescriptionCacheRecord(cachePath, cacheRecord);
        if (generatedDescriptions % safeBatchSize === 0) await reportBatch();
      }
      descriptionRecords.set(imageKey, cacheRecord || null);
    }

    persisted.push({
      imageKey,
      page,
      index,
      width: image.width,
      height: image.height,
      description:
        cacheRecord?.status === "success" ? cacheRecord.description : "",
      absolutePath,
      storageRelativePath: `${safeId}/${filename}`,
    });
  }

  await reportBatch();

  return persisted;
}

function buildPageImageMetadata(images = []) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((image) => IMAGE_KEY_PATTERN.test(String(image?.imageKey || "")))
    .map((image) => ({
      image_key: image.imageKey,
      page: image.page,
      image_index: image.index,
      description: typeof image.description === "string" ? image.description : "",
      storage_relative_path: image.storageRelativePath,
    }));
}

module.exports = {
  IMAGE_KEY_PATTERN,
  DEFAULT_MAX_IMAGE_DESCRIPTIONS,
  DEFAULT_IMAGE_DESCRIPTION_BATCH_SIZE,
  DEFAULT_IMAGE_DESCRIPTION_MAX_PER_RUN,
  resolveDescriptionProcessingLimits,
  imageHash,
  imageIsUseful,
  extractImagesFromDocument,
  extractPdfRasterImages,
  createGeminiImageDescriber,
  readDescriptionCacheRecord,
  writeDescriptionCacheRecord,
  persistPdfImages,
  buildPageImageMetadata,
};
