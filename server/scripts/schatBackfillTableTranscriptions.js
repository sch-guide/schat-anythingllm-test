// 쪽별 "표 정리" 만들기 (2026-10-24).
//
// 등록된 PDF의 원본을 쪽 그림으로 만들어 Gemini(그림 설명과 같은 모델, 기본 3.8)에게
// 표만 행·열대로 글로 옮기게 하고 storage/document-tables에 저장한다.
// 검색 자료(Chroma·BM25)와 등록 문서는 바꾸지 않는다. 이미 확인한 쪽은 건너뛴다(--force로 다시).
//
// 사용: node scripts/schatBackfillTableTranscriptions.js --title "실무지침서" [--pages 113-128] [--dry-run] [--force]
//       --title 은 문서 제목의 일부(새 판만). --pages 를 빼면 문서 전체.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROMPT = [
  "이 문서 쪽에서 '데이터 표'만 글로 옮겨 주세요.",
  "데이터 표란 머리글 행·열이 있고 칸마다 값이 들어 있는 표입니다. 쪽 전체의 테두리, 제목 상자, 단계 흐름도, 화면 캡처 그림은 표가 아닙니다.",
  "표마다 '표: (표 위 제목)'으로 시작하고, 행마다 '행 이름 | 열 이름: 칸 내용 | 열 이름: 칸 내용' 형식으로 모든 칸을 적으세요.",
  "여러 열이나 여러 행에 걸친(합친) 칸은 해당하는 열·행 모두에 같은 내용을 적으세요.",
  "원문 글자·숫자·단위를 그대로 쓰고, 설명·추측·요약은 넣지 마세요.",
  "데이터 표가 없으면 '표 없음'만 쓰세요.",
].join(" ");

function args() {
  const out = { title: "", pages: null, dryRun: false, force: false, concurrency: 2 };
  const list = process.argv.slice(2);
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "--title") out.title = list[++i] || "";
    else if (list[i] === "--pages") {
      const [a, b] = String(list[++i] || "").split("-").map(Number);
      out.pages = [a, b || a];
    } else if (list[i] === "--dry-run") out.dryRun = true;
    else if (list[i] === "--force") out.force = true;
    else if (list[i] === "--concurrency") out.concurrency = Math.max(1, Math.min(4, Number(list[++i]) || 2));
  }
  if (!out.title.trim()) throw new Error('--title "문서 제목 일부"를 넣어 주세요.');
  return out;
}

/** 모델 답에서 "표 없음"이면 "". */
function cleanTranscription(text = "") {
  const value = String(text || "").replace(/\r/g, "").trim();
  if (!value || /^표\s*없음\.?$/u.test(value)) return "";
  return value.replace(/\*\*/g, "");
}

async function main() {
  process.chdir(path.resolve(__dirname, ".."));
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
  const options = args();
  const prisma = require("../utils/prisma");
  const { defaultStorageRoot } = require("../utils/originalDocuments");
  const { modelFor } = require("../utils/schatModels");
  const store = require("../utils/documentTables/store");

  const rows = await prisma.workspace_documents.findMany({ select: { metadata: true } });
  const documents = new Map();
  for (const row of rows) {
    let meta = {};
    try {
      meta = JSON.parse(row.metadata || "{}");
    } catch {}
    if (meta.schat_document_update_archived === true || !meta.document_id) continue;
    if (!/\.pdf$/i.test(meta.title || "") || !(meta.title || "").includes(options.title)) continue;
    documents.set(meta.document_id, meta.title);
  }
  if (documents.size !== 1)
    throw new Error(`제목에 "${options.title}"가 들어간 현재 PDF가 ${documents.size}개입니다. 하나만 고르도록 제목을 더 자세히 적어 주세요. (${[...documents.values()].join(", ")})`);
  const [[documentId, title]] = [...documents.entries()];
  const file = path.join(
    defaultStorageRoot(),
    `${crypto.createHash("sha256").update(String(documentId)).digest("hex")}.pdf`
  );
  if (!fs.existsSync(file)) throw new Error(`원본 PDF가 없습니다: ${title}`);

  const collector = path.resolve(__dirname, "../../collector");
  const pdfjs = await import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs", { paths: [collector] }));
  const { createCanvas } = require(require.resolve("canvas", { paths: [collector] }));
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableFontFace: true }).promise;
  const [from, to] = options.pages || [1, pdf.numPages];
  const pages = [];
  for (let page = Math.max(1, from); page <= Math.min(pdf.numPages, to); page++)
    if (options.force || !store.hasTableRecord(documentId, page)) pages.push(page);

  const model = process.env.SCHAT_TABLE_TRANSCRIPTION_MODEL || modelFor("imageDescription");
  console.log(`문서: ${title} / 처리할 쪽 ${pages.length}개 (${from}~${to}쪽) / 모델 ${model}${options.dryRun ? " / 시험(호출 안 함)" : ""}`);
  if (options.dryRun || !pages.length) return;
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY가 없습니다.");
  const { OpenAI } = require("openai");
  const client = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    maxRetries: 1,
  });

  let done = 0, withTable = 0, failed = 0;
  const queue = [...pages];
  async function worker() {
    while (queue.length) {
      const page = queue.shift();
      try {
        const pdfPage = await pdf.getPage(page);
        const viewport = pdfPage.getViewport({ scale: 2 });
        const canvas = createCanvas(viewport.width, viewport.height);
        await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const image = canvas.toBuffer("image/png").toString("base64");
        const response = await client.chat.completions.create({
          model,
          temperature: 0,
          messages: [{ role: "user", content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: `data:image/png;base64,${image}`, detail: "high" } },
          ] }],
        });
        const text = cleanTranscription(response?.choices?.[0]?.message?.content || "");
        store.writeTableText(documentId, page, text, { model });
        if (text) withTable++;
      } catch (error) {
        failed++;
        console.warn(`  ${page}쪽 실패(다음에 다시 시도됨): ${String(error.message).slice(0, 120)}`);
      }
      done++;
      if (done % 10 === 0 || done === pages.length)
        console.log(`  진행 ${done}/${pages.length}쪽 · 표 있음 ${withTable} · 실패 ${failed}`);
    }
  }
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  console.log(`끝: ${pages.length}쪽 확인, 표가 있는 쪽 ${withTable}, 실패 ${failed}`);
}

if (require.main === module)
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("중단:", error.message);
      process.exit(1);
    });

module.exports = { cleanTranscription, PROMPT };
