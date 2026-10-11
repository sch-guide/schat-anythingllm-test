// 동의어 관리 화면의 검토 규칙(화면 코드와 테스트가 함께 쓴다).
// - 자동 후보는 "검토 필요" 상태로만 들어온다.
// - 이미 사용 중인 묶음이라도 승인 대기 중인 "추가 후보"가 있으면
//   "검토 필요" 목록에 함께 보여 준다. 묶음 자체의 상태는 바뀌지 않는다.

export const SOURCE_LABELS = {
  admin: "직접 등록",
  draft: "초안",
  auto: "자동 제안",
};

export function hasPendingAdditions(group = {}) {
  return (group.pendingAdditions || []).length > 0;
}

export function inFilter(group = {}, filter = "all") {
  if (filter === "all") return true;
  if (filter === "needs_review")
    return group.status === "needs_review" || hasPendingAdditions(group);
  return group.status === filter;
}

export function countGroups(groups = []) {
  const counts = { all: 0, needs_review: 0, active: 0, off: 0 };
  for (const group of groups)
    for (const key of Object.keys(counts))
      if (inFilter(group, key)) counts[key] += 1;
  return counts;
}

// "검사 및 시술(26.04.07).pdf p.13, 14" — page numbers are for the
// administrator only; staff screens never show them.
export function describeSources(sources = []) {
  return sources
    .map((source) => {
      const pages = (source.pages || []).length
        ? ` p.${source.pages.join(", ")}`
        : "";
      return `${source.documentName || "이름 없는 문서"}${pages}${
        source.missing ? " (삭제된 문서)" : ""
      }`;
    })
    .join(" · ");
}

export function confidenceText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `확신도 ${Math.round(number * 100)}%`;
}

export function createdText(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())} 자동 생성`;
}

export const RUN_TRIGGER_LABELS = {
  upload: "문서 등록",
  document_update: "문서 새 버전",
  backfill: "기존 문서 한 번 실행",
};

// The numbers the administrator checks after a run.
export function runTotals(summary = {}) {
  return [
    ["대상 문서", summary.documents],
    ["전체 후보", summary.candidates],
    ["새 묶음", summary.newGroups],
    ["추가 후보", summary.additions],
    ["중복 제외", summary.duplicates],
    ["애매해서 제외", summary.excluded],
    ["텍스트 부족", summary.textShort],
    ["실패", summary.failed],
    ["Gemini 호출", summary.geminiCalls],
    ["재시도", summary.retries],
  ].map(([label, value]) => ({ label, value: Number(value) || 0 }));
}
