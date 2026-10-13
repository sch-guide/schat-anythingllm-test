// 문서 등록 창 왼쪽 목록의 계산(화면과 분리해 검사함).

const norm = (value = "") =>
  String(value).normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

// 문서 이름으로 찾기. 띄어쓰기는 무시하고 비교함("검사및시술" = "검사 및 시술").
export function filterLibrary(documents = [], query = "") {
  const q = norm(query).replace(/ /g, "");
  if (!q) return documents;
  return documents.filter((doc) =>
    norm(doc.title).replace(/ /g, "").includes(q)
  );
}

export const docpathOf = (file) => `${file.folderName}/${file.name}`;

/**
 * @param {object} doc 서버 문서 한 줄
 * @param {Set<string>} staged 등록 목록에 올린 docpath
 * @param {Set<string>} processing 처리 중인 docpath
 */
export function libraryStatus(doc, staged = new Set(), processing = new Set()) {
  const free = doc.freeFiles || [];
  if (free.length && free.some((f) => processing.has(docpathOf(f))))
    return { key: "processing", label: "처리 중", selectable: false };
  if (free.length && free.every((f) => staged.has(docpathOf(f))))
    return { key: "staged", label: "등록 대기", selectable: false };
  if (doc.status === "registered")
    return { key: "registered", label: "등록됨", selectable: false };
  if (doc.status === "partial")
    return { key: "partial", label: "일부 등록", selectable: true };
  if (doc.olderCopy)
    return { key: "older", label: "예전 업로드", selectable: true };
  return { key: "unregistered", label: "등록 전", selectable: true };
}

// 방금 올린 파일이 들어 있는 문서를 미리 골라 둠.
export function uploadedKeys(documents = [], docpaths = []) {
  const uploaded = new Set(docpaths);
  return documents
    .filter((doc) =>
      (doc.freeFiles || []).some((f) => uploaded.has(docpathOf(f)))
    )
    .map((doc) => doc.key);
}

export function filesToStage(
  documents = [],
  keys = new Set(),
  staged = new Set()
) {
  return documents
    .filter((doc) => keys.has(doc.key))
    .flatMap((doc) => doc.freeFiles || [])
    .filter((file) => !staged.has(docpathOf(file)));
}

// "현재 사용 중"(등록·일부 등록)과 "예전 문서·등록 전"으로 나눔.
export function librarySections(documents = []) {
  const current = documents.filter((doc) =>
    ["registered", "partial"].includes(doc.status)
  );
  const old = documents.filter(
    (doc) => !["registered", "partial"].includes(doc.status)
  );
  return { current, old };
}

/**
 * 서버 안전 점검(저장공간 점검 보고서)으로 삭제 가능 여부를 정함.
 * 화면 표시는 참고용이며, 실제 삭제 직전에 서버가 다시 확인함.
 * @param {object} doc 문서 목록 한 줄
 * @param {Map<string, object>|null} groups 점검 보고서 묶음(key별)
 * @param {boolean} isAdmin 관리자만 삭제 가능
 */
export function deleteState(doc, groups, isAdmin) {
  if (["registered", "partial"].includes(doc.status))
    return { deletable: false, reason: "현재 사용 중인 문서입니다." };
  if (!isAdmin) return { deletable: false, reason: "" };
  if (!groups) return { deletable: false, reason: "안전 점검 중..." };
  const group = doc.cleanupKey ? groups.get(doc.cleanupKey) : null;
  if (!group)
    return {
      deletable: false,
      reason: "안전 점검 결과가 아직 없어요. 잠시 뒤 다시 열어 주세요.",
    };
  if (group.status === "old_upload") return { deletable: true, reason: "" };
  if (group.status === "in_use")
    return {
      deletable: false,
      reason: "현재 사용 중인 자료와 연결되어 있습니다.",
    };
  return {
    deletable: false,
    reason:
      (group.reasons || []).join(" ") || "확인이 필요해 삭제할 수 없습니다.",
  };
}

export function checklistCount(doc, groups) {
  const group = doc.cleanupKey && groups ? groups.get(doc.cleanupKey) : null;
  return Number(group?.usage?.checklists) || 0;
}
