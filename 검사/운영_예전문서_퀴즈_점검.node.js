// 예전 문서 삭제 차단·퀴즈 근거 없음 원인 점검 (읽기 전용: 아무것도 쓰거나 지우지 않음, AI 호출 없음)
// 운영 서버 저장소 폴더에서 실행:
//   docker exec -i -w /app/server -e DIAG_NAME=중심정맥관 -e DIAG_TOPIC=중심정맥관 schat-web node - < 검사/운영_예전문서_퀴즈_점검.node.js
// 출력에는 문서 번호 앞 8자리·건수·쪽 번호만 나오고 질문·답변·본문은 나오지 않음.
const NAME = process.env.DIAG_NAME || "중심정맥관";
const TOPIC = process.env.DIAG_TOPIC || "중심정맥관";
(async () => {
  const prisma = require("./utils/prisma");
  const sc = require("./utils/schatAdmin/storageCleanup");
  const short = (v) => String(v || "").slice(0, 8);

  console.log(`== 1. 저장공간 판정 (제목에 '${NAME}') ==`);
  const inputs = await sc.loadStorageCleanupInputs();
  const report = sc.classifyStorage(inputs);
  const refsMap = inputs.originalReferences;
  for (const g of report.groups.filter((g) => String(g.title).includes(NAME))) {
    const refs = refsMap instanceof Map && g.documentId ? refsMap.get(sc.originalStorageKey(g.documentId)) : null;
    console.log(JSON.stringify({
      doc: short(g.documentId), kind: g.kind, status: g.status,
      reasons: g.reasons, usage: g.usage, pastAnswerRefs: g.pastAnswerRefs,
      refs: refs ? refs.counts : null,
    }));
  }

  console.log(`\n== 2. 등록 행 (현재/보관) ==`);
  const rows = await prisma.workspace_documents.findMany({ select: { docId: true, workspaceId: true, metadata: true } });
  const byDoc = new Map();
  for (const r of rows) {
    let m = {}; try { m = JSON.parse(r.metadata || "{}"); } catch {}
    if (!String(m.title || "").includes(NAME)) continue;
    const k = `${m.document_id}|${m.schat_document_update_archived === true ? "보관" : "현재"}|ws${r.workspaceId}`;
    const e = byDoc.get(k) || { docIds: [], pages: new Set() };
    e.docIds.push(r.docId); e.pages.add(m.page); byDoc.set(k, e);
  }
  for (const [k, e] of byDoc) console.log(k.replace(/^([^|]{8})[^|]*/, "$1"), `행 ${e.docIds.length}개, 쪽 ${e.pages.size}개`);

  console.log(`\n== 3. 퀴즈·과거 답변 연결 (문서별) ==`);
  const ids = [...new Set([
    ...[...byDoc.keys()].map((k) => k.split("|")[0]),
    ...report.groups.filter((g) => String(g.title).includes(NAME) && g.documentId).map((g) => g.documentId),
  ])];
  const { pdfRefForDocumentId } = require("./utils/originalDocuments");
  const chatRows = await prisma.workspace_chats.findMany({ select: { response: true } });
  for (const id of ids) {
    const ref = pdfRefForDocumentId(id);
    const byRef = chatRows.filter((c) => String(c.response || "").includes(`"${ref}"`)).length;
    const byId = chatRows.filter((c) => String(c.response || "").includes(`"${id}"`)).length;
    console.log(short(id), `과거 답변: 출처값(pdfRef) ${byRef}건, 문서번호 ${byId}건`);
  }
  for (const id of ids) {
    const [q, s, l] = await Promise.all([
      prisma.schat_quiz_questions.count({ where: { document_id: id } }),
      prisma.schat_quiz_sets.count({ where: { document_id: id } }),
      prisma.schat_quiz_generation_logs.groupBy({ by: ["status"], where: { document_id: id }, _count: true }),
    ]);
    console.log(short(id), `현재 문항 ${q}, 세트 ${s}, 생성기록`, JSON.stringify(l.map((x) => [x.status, x._count])));
  }

  console.log(`\n== 4. Chroma 문단의 document_id (현재 등록 행 기준) ==`);
  const bank = require("./utils/schatQuiz/bank");
  const live = await bank.liveDocuments({ fresh: true });
  const docs = [...live.values()].filter((d) => d.title.includes(NAME));
  const { getVectorDbClass } = require("./utils/helpers");
  const V = getVectorDbClass();
  const { client } = await V.connect();
  for (const d of docs) {
    const maps = await prisma.document_vectors.findMany({ where: { docId: { in: d.docIds } }, select: { vectorId: true } });
    const col = await client.getCollection({ name: V.normalize ? V.normalize(d.workspaceSlug) : d.workspaceSlug });
    const ids2 = maps.map((m) => m.vectorId);
    const tally = {}; let topicHits = 0, compactHits = 0, bodyChunks = 0;
    for (let i = 0; i < ids2.length; i += 100) {
      const got = await col.get({ ids: ids2.slice(i, i + 100), include: ["documents", "metadatas"] });
      got.metadatas.forEach((m, j) => {
        const key = m?.document_id === d.documentId ? "현재" : `다름:${short(m?.document_id)}`;
        tally[key] = (tally[key] || 0) + 1;
        if (m?.content_type === "image_description") return;
        bodyChunks += 1;
        const t = String(got.documents[j] || "");
        if (t.includes(TOPIC)) topicHits += 1;
        if (t.replace(/\s+/g, "").includes(TOPIC)) compactHits += 1;
      });
    }
    const byWhere = await col.get({ where: { document_id: d.documentId }, include: [] });
    console.log(JSON.stringify({ doc: short(d.documentId), title: d.title, ws: d.workspaceSlug, 등록행: d.docIds.length,
      연결문단: ids2.length, 문단의문서번호: tally, 현재번호로검색되는문단: byWhere.ids.length,
      본문문단: bodyChunks, 주제그대로포함: topicHits, 띄어쓰기무시포함: compactHits }));

    console.log(`\n== 5. 퀴즈 근거 찾기 그대로 실행 (AI 호출 없음) ==`);
    const gen = require("./utils/schatQuiz/generation");
    const ev = await gen.collectEvidence({ documentId: d.documentId, workspaceSlug: d.workspaceSlug, topic: TOPIC, docIds: d.docIds, title: d.title });
    console.log(short(d.documentId), `근거 쪽: [${ev.map((e) => e.page).join(", ")}]`);
  }
  process.exit(0);
})().catch((e) => { console.error("점검 실패:", e.message); process.exit(1); });
