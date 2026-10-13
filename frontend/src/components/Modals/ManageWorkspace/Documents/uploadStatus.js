// SCHAT 문서 등록 화면의 쉬운 상태·오류 문구. 자세한 오류는 화면에 그대로
// 보여주지 않고 관리자 시스템 기록(문서 처리 실패)에서 확인함.

export const PDF_ACCEPT = { "application/pdf": [".pdf"] };
export const DOCUMENT_ACCEPT = {
  ...PDF_ACCEPT,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
};
export function isSupportedDocumentFile(file) {
  return /\.(pdf|xlsx|xls)$/i.test(String(file?.name || ""));
}

export const STATUS_TEXT = {
  pending: "대기 중",
  embedding: "처리 중",
  complete: "완료",
  failed: "실패",
};

// 업로드 실패 원문 → "문서 처리에 실패했습니다." + 간단한 원인
export function uploadFailureReason(raw = "") {
  const text = String(raw || "");
  if (
    /file-invalid-type|not supported|unsupported|invalid file upload/i.test(
      text
    )
  )
    return "지원하지 않는 파일";
  if (/not online|processing api/i.test(text)) return "문서 처리기 연결 안 됨";
  if (/file-too-large/i.test(text)) return "파일이 너무 큼";
  if (/xlsx|xls\b|spreadsheet|excel|엑셀/i.test(text)) return "엑셀 읽기 실패";
  if (
    /pdf|no text content|could not (read|parse)|encrypted|password/i.test(text)
  )
    return "PDF 읽기 실패";
  return "처리 중 오류";
}

export function uploadFailureText(raw = "") {
  return `문서 처리에 실패했습니다. (${uploadFailureReason(raw)})`;
}

// "검사및시술(260306).pdf-page-11-<uuid>.json" → 쪽 번호와 문서 묶음 열쇠
const PAGE_DOC =
  /^(.*)-page-(\d+)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/i;
const PLAIN_DOC =
  /-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/i;

export function pageInfo(docpath = "") {
  const base = String(docpath).split("/").pop() || String(docpath);
  const match = base.match(PAGE_DOC);
  if (match) return { key: match[1], page: Number(match[2]) };
  return { key: base.replace(PLAIN_DOC, ""), page: null };
}

/**
 * 쪽(page)별 처리 상태를 문서 단위로 묶음.
 * @param {Record<string, {status: string, chunksProcessed?: number, totalChunks?: number}>} progress
 * @param {Record<string, {title?: string, documentId?: string}>} meta docpath →
 *   원래 문서 이름(한글 포함)과 같은 PDF의 쪽들이 함께 갖는 document_id.
 *   모르면 내부 파일 이름으로 묶음(한글이 빠진 이름일 수 있음).
 */
export function groupEmbeddingProgress(progress = {}, meta = {}) {
  const groups = new Map();
  for (const [docpath, state] of Object.entries(progress || {})) {
    const { key: fileKey, page } = pageInfo(docpath);
    const info = meta[docpath] || {};
    const key = info.documentId
      ? `id:${info.documentId}`
      : info.title
        ? `title:${info.title}`
        : `file:${fileKey}`;
    const group = groups.get(key) || { key, name: "", items: [] };
    if (!group.name && info.title) group.name = info.title;
    if (!group.name) group.fallbackName = fileKey;
    group.items.push({ docpath, page, ...state });
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const items = group.items.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
    const total = items.length;
    const counts = { pending: 0, embedding: 0, complete: 0, failed: 0 };
    let work = 0;
    for (const item of items) {
      const status =
        counts[item.status] !== undefined ? item.status : "pending";
      counts[status] += 1;
      if (status === "complete" || status === "failed") work += 1;
      else if (status === "embedding" && item.totalChunks > 0)
        work += Math.min(1, (item.chunksProcessed || 0) / item.totalChunks);
    }
    const status =
      counts.failed > 0 && counts.failed + counts.complete === total
        ? "failed"
        : counts.complete === total
          ? "complete"
          : counts.embedding > 0 || counts.complete > 0 || counts.failed > 0
            ? "embedding"
            : "pending";
    return {
      key: group.key,
      name: group.name || group.fallbackName || "이름 없는 문서",
      status,
      label: STATUS_TEXT[status],
      percent: Math.round((work / Math.max(1, total)) * 100),
      total,
      failed: counts.failed,
      // 대기 중인 쪽만 대기열에서 뺄 수 있음
      removable:
        counts.pending === total ? items.map((item) => item.docpath) : [],
      items,
    };
  });
}
