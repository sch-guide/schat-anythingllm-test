// 퀴즈 근거 없음 · 예전 Excel 삭제 불가 원인 점검 (읽기 전용: 아무것도 쓰거나 지우지 않음, AI 호출 없음)
// 운영 서버 저장소 폴더에서 실행:
//   docker exec -i -w /app/server -e DIAG_NAME=중심정맥관 -e DIAG_TOPIC=중심정맥관 schat-web node - < 검사/운영_퀴즈근거_엑셀삭제_점검.node.js
// 출력: 문서 번호 앞 8자리, 건수, 쪽 번호, 파일 이름만. 질문·답변·본문 문장은 출력하지 않음.
const NAME = process.env.DIAG_NAME || "중심정맥관";
const TOPIC = process.env.DIAG_TOPIC || "중심정맥관";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const short = (v) => String(v || "").slice(0, 8);
const out = (label, value) => console.log(label, typeof value === "string" ? value : JSON.stringify(value));

(async () => {
  const prisma = require("./utils/prisma");
  const bank = require("./utils/schatQuiz/bank");
  const gen = require("./utils/schatQuiz/generation");
  const sc = require("./utils/schatAdmin/storageCleanup");
  const { pdfRefForDocumentId } = require("./utils/originalDocuments");
  const { getVectorDbClass } = require("./utils/helpers");
  const { rankByBm25 } = require("./utils/vectorDbProviders/chroma/schatBm25");
  const V = getVectorDbClass();
  const { client } = await V.connect();
  const rows = await prisma.workspace_documents.findMany({ select: { id: true, docId: true, docpath: true, workspaceId: true, metadata: true } });
  const meta = (r) => { try { return JSON.parse(r.metadata || "{}"); } catch { return {}; } };
  const workspaces = await prisma.workspaces.findMany({ select: { id: true, slug: true } });
  const slugOf = new Map(workspaces.map((w) => [w.id, w.slug]));
  const chats = await prisma.workspace_chats.findMany({ select: { response: true } });
  const pastAnswers = (id) => {
    const ref = pdfRefForDocumentId(id);
    return chats.filter((c) => { const s = String(c.response || ""); return s.includes(`"${ref}"`) || s.includes(`"${id}"`); }).length;
  };

  // ================= 1. 퀴즈 =================
  console.log(`\n######## 1. 퀴즈: 제목에 '${NAME}', 주제 '${TOPIC}' ########`);
  console.log("\n== 1-1. 등록 행(같은 제목의 모든 버전) ==");
  const byDoc = new Map();
  for (const r of rows) {
    const m = meta(r);
    if (!String(m.title || "").includes(NAME)) continue;
    const id = String(m.document_id || "(없음)");
    const e = byDoc.get(id) || { title: String(m.title).split(/[\\/]/).pop(), rows: 0, archived: 0, ws: new Set(), docIds: [] };
    e.rows += 1; if (m.schat_document_update_archived === true) e.archived += 1;
    e.ws.add(slugOf.get(r.workspaceId)); e.docIds.push(r.docId); byDoc.set(id, e);
  }
  for (const [id, e] of byDoc) out(`문서 ${short(id)}`, { 제목: e.title, 등록행: e.rows, 보관행: e.archived, 작업공간: [...e.ws] });

  console.log("\n== 1-2. 퀴즈가 쓰는 현재 문서(퀴즈 문서 목록 기준) ==");
  const live = await bank.liveDocuments({ fresh: true });
  const docs = [...live.values()].filter((d) => d.title.includes(NAME));
  if (!docs.length) console.log("퀴즈 문서 목록에 이 제목의 현재 문서가 없음");
  for (const d of docs) {
    out(`현재 ${short(d.documentId)}`, { 제목: d.title, 작업공간: d.workspaceSlug, 연결행: d.docIds.length, 쪽: d.pages.size, docKey: d.docKey });
    const maps = await prisma.document_vectors.findMany({ where: { docId: { in: d.docIds } }, select: { vectorId: true, docId: true } });
    out("  검색데이터 연결(document_vectors)", { 문단: maps.length, 연결된행: new Set(maps.map((m) => m.docId)).size });
    const col = await client.getCollection({ name: V.normalize ? V.normalize(d.workspaceSlug) : d.workspaceSlug });
    const ids = maps.map((m) => m.vectorId);
    const got = { ids: [], documents: [], metadatas: [] };
    for (let i = 0; i < ids.length; i += 100) {
      const b = await col.get({ ids: ids.slice(i, i + 100), include: ["documents", "metadatas"] });
      for (const k of Object.keys(got)) got[k].push(...b[k]);
    }
    const tally = {}; const types = {}; let badPage = 0, noText = 0, body = 0;
    got.metadatas.forEach((m, j) => {
      const k = m?.document_id === d.documentId ? "현재번호" : `다른번호:${short(m?.document_id)}`;
      tally[k] = (tally[k] || 0) + 1;
      const t = m?.content_type || "본문"; types[t] = (types[t] || 0) + 1;
      if (!got.documents[j]) noText += 1;
      else if (!Number.isInteger(Number(m?.page))) badPage += 1;
      else if (m?.content_type !== "image_description") body += 1;
    });
    out("  Chroma(연결된 문단 실제 조회)", { 찾은문단: got.ids.length, 연결수와차이: ids.length - got.ids.length, 문단의문서번호: tally, 종류: types, 쪽번호없음: badPage, 글없음: noText, 퀴즈가쓸본문: body });
    const byWhere = await col.get({ where: { document_id: d.documentId }, include: [] });
    out("  Chroma(현재 문서번호로 조회)", { 문단: byWhere.ids.length });
    const corpus = got.ids.map((id, i) => ({ id, text: got.documents[i], metadata: got.metadatas[i] || {} }))
      .filter((x) => x.text && x.metadata.content_type !== "image_description" && Number.isInteger(Number(x.metadata.page)));
    const ranked = rankByBm25(TOPIC, corpus);
    const compactHits = corpus.filter((x) => String(x.text).replace(/\s+/g, "").includes(TOPIC.replace(/\s+/g, ""))).length;
    out("  주제 검색(퀴즈 전용)", { BM25결과: ranked.length, 띄어쓰기무시포함문단: compactHits });
    const ev = await gen.collectEvidence({ documentId: d.documentId, workspaceSlug: d.workspaceSlug, topic: TOPIC, docIds: d.docIds, title: d.title });
    out("  퀴즈 근거(실제 함수)", { 근거쪽: ev.map((e) => e.page), 글자수: ev.reduce((a, e) => a + e.text.length, 0) });
    // 디스크의 쪽 파일(본문 원본 데이터)
    const pageFiles = rows.filter((r) => d.docIds.includes(r.docId)).map((r) => r.docpath);
    const docsDir = path.join(process.env.STORAGE_DIR || path.resolve("storage"), "documents");
    let exist = 0, textChars = 0;
    for (const p of pageFiles) { try { const j = JSON.parse(fs.readFileSync(path.join(docsDir, p), "utf8")); exist += 1; textChars += String(j.pageContent || "").length; } catch {} }
    out("  쪽 파일(디스크)", { 등록행: pageFiles.length, 파일있음: exist, 본문글자수: textChars });
    out("  과거 답변에서 이 문서 출처", pastAnswers(d.documentId));
  }

  console.log("\n== 1-3. 퀴즈·생성 기록(문서별) ==");
  for (const id of byDoc.keys()) {
    const [q, s, logs] = await Promise.all([
      prisma.schat_quiz_questions.groupBy({ by: ["status"], where: { document_id: id }, _count: true }),
      prisma.schat_quiz_sets.count({ where: { document_id: id } }),
      prisma.schat_quiz_generation_logs.findMany({ where: { document_id: id }, orderBy: { id: "desc" }, take: 5, select: { topic: true, status: true, created_count: true, createdAt: true } }),
    ]);
    out(`문서 ${short(id)}`, { 문항: q.map((x) => [x.status, x._count]), 세트: s, 최근생성기록: logs.map((l) => [l.createdAt?.toISOString?.().slice(0, 16), l.topic === TOPIC ? "같은주제" : "다른주제", l.status, l.created_count]) });
  }

  // ================= 2. Excel =================
  console.log("\n######## 2. Excel 삭제 점검 ########");
  const inputs = await sc.loadStorageCleanupInputs();
  const report = sc.classifyStorage(inputs);
  const sheetRoot = path.join(process.env.STORAGE_DIR || path.resolve("storage"), "original-spreadsheets");
  const excelGroups = report.groups.filter((g) => /\.(xlsx|xls)$/i.test(String(g.title)));
  if (!excelGroups.length) console.log("삭제 점검 목록에 Excel 문서가 없음");
  for (const g of excelGroups) {
    const key = g.documentId ? createHash("sha256").update(g.documentId).digest("hex") : "";
    const sheet = ["xlsx", "xls"].some((x) => key && fs.existsSync(path.join(sheetRoot, `${key}.${x}`)));
    const regs = rows.filter((r) => meta(r).document_id === g.documentId);
    const refs = inputs.originalReferences instanceof Map && g.documentId ? inputs.originalReferences.get(sc.originalStorageKey(g.documentId))?.counts : null;
    out(`Excel ${short(g.documentId)} ${g.title}`, {
      판정: g.status, 사유: g.reasons, 사용: g.usage, 과거답변경고건수: g.pastAnswerRefs,
      연결: refs, 등록행: regs.length, 보관행: regs.filter((r) => meta(r).schat_document_update_archived === true).length,
      쪽파일: (g.pagePaths || []).length + (g.pageFiles || []).length, Excel원본: sheet, 과거답변출처: g.documentId ? pastAnswers(g.documentId) : 0,
    });
  }
  // 삭제 점검 목록에 없는 Excel 원본(어느 문서에도 묶이지 않은 원본)
  const known = new Set(report.groups.filter((g) => g.documentId).map((g) => createHash("sha256").update(g.documentId).digest("hex")));
  const loose = fs.existsSync(sheetRoot) ? fs.readdirSync(sheetRoot).filter((n) => /\.(xlsx|xls)$/i.test(n) && !known.has(n.split(".")[0])) : [];
  out("문서와 묶이지 않은 Excel 원본 수", loose.length);
  process.exit(0);
})().catch((e) => { console.error("점검 실패:", e.message); process.exit(1); });
