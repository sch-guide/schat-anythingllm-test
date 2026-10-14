// SCHAT PDF 그림 설명 모델 비교 시험 (2026-10-14)
//
// 등록된 그림을 후보 모델마다 "문서 등록 때와 같은 지시문"으로 다시 설명하게 하고,
// 1) 설명 실패, 2) 처리 시간·토큰, 3) 검색 연결 정확도를 비교한다.
// 검색 연결 정확도: 만든 설명을 검색 Embedding으로 바꿔, 같은 문서의 본문 문단 중
// 그 그림이 있는 쪽의 문단을 몇 위로 찾는지 본다(Hit@1·@3·@5). 그림 내용을 잘 담은
// 설명일수록 자기 쪽 본문과 가깝다.
//
// - 저장소·검색 자료를 바꾸지 않는다(읽기만 함). 실제 Gemini를 호출하므로 비용이 든다.
// - 실행 조건: SCHAT_ALLOW_MODEL_COMPARE=true. 결과 JSON에는 설명 원문이 있어 Git에 넣지 않는다.
//
// 사용: SCHAT_ALLOW_MODEL_COMPARE=true node scripts/schatImageDescriptionCompare.js \
//         --models gemini-3.8-flash,gemini-3.5-flash-lite --sample 60 --out /tmp/image-compare.json
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

function parseArgs(argv) {
  const args = { models: [], sample: 60, out: "/tmp/schat-image-compare.json", slug: "schat-2026-09-22" };
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index], argv[index + 1]];
    if (key === "--models") args.models = value.split(",").map((m) => m.trim()).filter(Boolean);
    if (key === "--sample") args.sample = Math.max(1, Math.min(300, Number(value) || 60));
    if (key === "--out") args.out = value;
    if (key === "--workspace") args.slug = value;
  }
  return args;
}

function cosine(a, b) {
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    left += a[index] * a[index];
    right += b[index] * b[index];
  }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}

/** 같은 문서 본문 문단 중 그림이 있는 쪽 문단의 최고 순위(1부터). 순수 함수. */
function pageRank(vector, chunks, page) {
  const ranked = chunks
    .map((chunk) => ({ page: chunk.page, score: cosine(vector, chunk.embedding) }))
    .sort((a, b) => b.score - a.score);
  const index = ranked.findIndex((chunk) => chunk.page === page);
  return index < 0 ? null : index + 1;
}

function summarize(rows) {
  const ok = rows.filter((row) => row.description);
  const ranks = ok.map((row) => row.rank).filter((rank) => rank !== null);
  const hit = (k) => ranks.filter((rank) => rank <= k).length;
  const sorted = (key) => rows.map((row) => row[key]).filter(Number.isFinite).sort((a, b) => a - b);
  const median = (list) => (list.length ? list[Math.floor(list.length / 2)] : null);
  return {
    images: rows.length,
    empty: rows.filter((row) => !row.description && !row.error).length,
    errors: rows.filter((row) => row.error).length,
    hit1: `${hit(1)}/${rows.length}`,
    hit3: `${hit(3)}/${rows.length}`,
    hit5: `${hit(5)}/${rows.length}`,
    medianRank: median([...ranks].sort((a, b) => a - b)),
    msMedian: median(sorted("ms")),
    lengthMedian: median(ok.map((row) => row.description.length).sort((a, b) => a - b)),
    promptTokens: rows.reduce((total, row) => total + (row.usage?.prompt_tokens || 0), 0),
    completionTokens: rows.reduce((total, row) => total + (row.usage?.completion_tokens || 0), 0),
  };
}

async function main() {
  if (process.env.SCHAT_ALLOW_MODEL_COMPARE !== "true")
    throw new Error("Set SCHAT_ALLOW_MODEL_COMPARE=true to run this comparison.");
  require("dotenv").config({ path: path.join(__dirname, "../.env") });
  const args = parseArgs(process.argv.slice(2));
  if (!args.models.length || args.models.some((model) => !/^gemini-[a-zA-Z0-9._-]+$/.test(model)))
    throw new Error("--models 에 Gemini 모델 이름을 지정해 주세요.");

  const prisma = require("../utils/prisma");
  const { Chroma } = require("../utils/vectorDbProviders/chroma");
  const { getLLMProvider } = require("../utils/helpers");
  const { createGeminiImageDescriber } = require("../../collector/processSingleFile/convert/asPDF/pdfImages");
  const storageRoot = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, "../storage"), "document-images");
  const embedder = getLLMProvider({ provider: "gemini" });

  const workspace = await prisma.workspaces.findFirst({ where: { slug: args.slug } });
  const reader = { normalize: Chroma.prototype.normalize };
  const { client } = await Chroma.prototype.connect.call(reader);
  const collection = await client.getCollection({ name: reader.normalize(workspace.slug) });
  const stored = await collection.get({ include: ["metadatas", "embeddings"] });

  // 문서별 본문 문단(그림 설명 문단 제외)과 그 Embedding
  const textByDocument = new Map();
  stored.ids.forEach((_, index) => {
    const metadata = stored.metadatas[index] || {};
    if (metadata.content_type === "image_description") return;
    const page = Number(metadata.page);
    const title = String(metadata.title || metadata.document_name || "");
    if (!title || !Number.isInteger(page)) return;
    if (!textByDocument.has(title)) textByDocument.set(title, []);
    textByDocument.get(title).push({ page, embedding: Array.from(stored.embeddings[index]) });
  });

  // 등록 문서의 그림 목록(같은 그림은 한 번만), 같은 쪽 본문이 있는 그림만 대상
  const rows = await prisma.workspace_documents.findMany({ where: { workspaceId: workspace.id }, select: { metadata: true } });
  const images = new Map();
  for (const row of rows) {
    let metadata;
    try {
      metadata = JSON.parse(row.metadata || "{}");
    } catch {
      continue;
    }
    const title = String(metadata.title || "");
    for (const image of metadata.pdf_images || []) {
      const page = Number(image.page || metadata.page);
      const chunks = textByDocument.get(title);
      if (!image?.image_key || images.has(image.image_key) || !chunks?.some((chunk) => chunk.page === page)) continue;
      const file = path.resolve(storageRoot, String(image.storage_relative_path || ""));
      if (!file.startsWith(storageRoot) || !fs.existsSync(file)) continue;
      images.set(image.image_key, { imageKey: image.image_key, title, page, file, stored: String(image.description || "") });
    }
  }
  // 문서·쪽 순서로 고르게 표본을 뽑는다(매번 같은 표본).
  const all = [...images.values()].sort((a, b) => a.title.localeCompare(b.title) || a.page - b.page || a.imageKey.localeCompare(b.imageKey));
  const step = Math.max(1, Math.floor(all.length / args.sample));
  const sample = all.filter((_, index) => index % step === 0).slice(0, args.sample);
  console.log(JSON.stringify({ candidates: all.length, sample: sample.length }));

  const result = { at: new Date().toISOString(), candidates: all.length, models: {} };
  const runs = [{ name: "stored(등록 당시 설명)", model: null }, ...args.models.map((model) => ({ name: model, model }))];
  for (const run of runs) {
    let lastUsage = null;
    const { OpenAI } = require("openai");
    const raw = new OpenAI({ apiKey: process.env.GEMINI_API_KEY, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", maxRetries: 1, timeout: 120000 });
    // 사용량을 읽기 위해 감싼 client. 지시문은 문서 등록 코드(createGeminiImageDescriber) 그대로다.
    const client = { chat: { completions: { create: async (body) => { const response = await raw.chat.completions.create(body); lastUsage = response.usage || null; return response; } } } };
    const describe = run.model ? createGeminiImageDescriber({ client, model: run.model }) : null;
    const output = [];
    for (const image of sample) {
      const row = { imageKey: image.imageKey, title: image.title, page: image.page };
      try {
        const start = performance.now();
        row.description = describe ? await describe(fs.readFileSync(image.file)) : image.stored;
        row.ms = describe ? Math.round(performance.now() - start) : null;
        row.usage = describe ? lastUsage : null;
        if (row.description) {
          const vector = await embedder.embedTextInput(row.description);
          row.rank = pageRank(vector, textByDocument.get(image.title), image.page);
        } else row.rank = null;
      } catch (error) {
        row.error = String(error?.message || error).slice(0, 160);
        row.rank = null;
      }
      output.push(row);
    }
    result.models[run.name] = { summary: summarize(output), rows: output };
    fs.writeFileSync(args.out, JSON.stringify(result, null, 1));
    console.log(JSON.stringify({ model: run.name, summary: result.models[run.name].summary }));
  }
  console.log("SAVED", args.out);
}

if (require.main === module)
  main().then(() => process.exit(0)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });

module.exports = { cosine, pageRank, summarize };
