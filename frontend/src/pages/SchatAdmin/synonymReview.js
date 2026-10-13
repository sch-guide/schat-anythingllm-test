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

export function isNewAiGroup(group = {}) {
  return (
    group.source === "auto" &&
    group.status === "needs_review" &&
    group.suggestion?.status === "pending"
  );
}

function isRejectedAiGroup(group) {
  return (
    group.source === "auto" &&
    group.status === "off" &&
    group.suggestion?.status === "dismissed"
  );
}

export function managementView(groups = [], query = "", aiOnly = false) {
  const listed = groups.filter((group) => !isRejectedAiGroup(group));
  const key = termKey(query);
  const hasAi = (group) => isNewAiGroup(group) || hasPendingAdditions(group);
  const shown = listed.filter(
    (group) =>
      (!aiOnly || hasAi(group)) &&
      (!key ||
        [
          ...group.terms,
          ...(group.pendingAdditions || []).flatMap((item) => item.terms),
        ].some((term) => termKey(term).includes(key)))
  );
  return {
    total: listed.length,
    aiCount: listed.filter(hasAi).length,
    newGroups: shown.filter(isNewAiGroup),
    mainGroups: shown.filter((group) => !isNewAiGroup(group)),
    proposalIds: [
      ...new Set(
        shown.flatMap((group) => [
          ...(isNewAiGroup(group) ? [group.suggestion.id] : []),
          ...(group.pendingAdditions || [])
            .filter((item) => !item.status || item.status === "pending")
            .map((item) => item.id),
        ])
      ),
    ],
  };
}

export function cleanTerm(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export function termKey(value) {
  return cleanTerm(value).toLowerCase().replace(/\s+/g, "");
}

export function validateTerms(raw, groups = [], original = null) {
  const terms = raw.map(cleanTerm).filter(Boolean);
  const keys = terms.map(termKey);
  if (new Set(keys).size !== keys.length)
    return "같은 단어를 두 번 넣을 수 없어요.";
  if (terms.length < 2) return "단어를 2개 이상 넣어 주세요.";
  if (terms.length > 20) return "한 묶음에는 20개까지 넣을 수 있습니다.";
  if (terms.some((term) => term.length > 40))
    return "단어는 40자 이하로 입력해 주세요.";
  const text = terms.join(" ").toLowerCase();
  if (
    ["삽입", "거치", "설치", "insertion", "insert"].some((word) =>
      text.includes(word)
    ) &&
    ["제거", "발거", "remove", "removal"].some((word) => text.includes(word))
  )
    return "삽입과 제거처럼 서로 다른 시술 동작은 한 묶음에 넣을 수 없습니다.";
  const previous = new Set((original?.terms || []).map(termKey));
  for (const group of groups) {
    if (group.id === original?.id) continue;
    if (isRejectedAiGroup(group)) continue;
    if (
      keys.some(
        (key) =>
          !previous.has(key) &&
          group.terms.some((term) => termKey(term) === key)
      )
    )
      return `${group.terms[0] || "다른"} 묶음에 이미 있어요.`;
  }
  return "";
}

export function canOpenSource(source = {}) {
  return Boolean(
    !source.missing &&
      source.originalPdfAvailable &&
      source.workspaceSlug &&
      /^[A-Za-z0-9_-]{43}$/.test(source.pdfRef || "")
  );
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
  staff_questions: "직원 질문",
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

// 후보 하나를 관리자가 확인할 수 있는 형태로 정리함. 직원 질문 예시는 서버에서
// 이미 이름·번호를 가린 한 줄만 옴(원문 질문은 내려오지 않음).
export function candidateDetail(proposal = {}, group = {}) {
  const sources = proposal.sources || [];
  const staff = sources.filter((item) => item.type === "staff_questions");
  const documents = sources.filter((item) => item.type !== "staff_questions");
  const origins = [];
  if (staff.length) origins.push("직원 질문");
  if (documents.length) origins.push("문서");
  if (String(proposal.method || "").startsWith("gemini") || !origins.length)
    origins.push("AI 자동 제안");
  const isAddition = proposal.type === "addition";
  const terms = proposal.terms?.length ? proposal.terms : group.terms || [];
  return {
    expression: terms.join(", "),
    related: isAddition
      ? (group.terms || []).join(", ")
      : "새 묶음 (관련된 기존 묶음 없음)",
    origins,
    staff: staff.map((item) => ({
      count: Number(item.count) || 0,
      example: item.example || "",
    })),
    documents: describeSources(documents),
    reason: proposal.reason || "",
    created: createdText(proposal.createdAt).replace(/ 자동 생성$/, ""),
    confidence: confidenceText(proposal.confidence),
    lowConfidence: proposal.lowConfidence === true,
  };
}

// 실행 기록 상태를 쉬운 말로. 저장 확인 필요는 실행 결과를 마지막에 기록하지
// 못한 상태라 화면 숫자가 실제와 다를 수 있음.
export const RUN_STATUS_TEXT = {
  done: "완료",
  failed: "실패",
  limited: "한도 도달로 중단",
  skipped: "건너뜀",
  running: "진행 중",
  retrying: "진행 중",
  removed: "삭제됨",
  persistence_failed: "저장 확인 필요",
};
export const RUN_FAILURE_STEPS = {
  run: "후보를 찾는 도중 실행 기록을 저장하지 못했어요.",
  final_record: "후보 찾기는 끝났지만 마지막 결과를 기록하지 못했어요.",
};
export function runProblem(run = {}) {
  if (run.status !== "persistence_failed") return null;
  const step = RUN_FAILURE_STEPS[run.summary?.failureStep];
  return {
    what:
      step ||
      "실행 결과를 마지막에 기록하지 못했어요. 아래 숫자는 실제와 다를 수 있어요.",
    check: [
      "동의어 목록에서 이 날짜에 새로 생긴 '검토 대기' 후보가 있는지 확인해 주세요. 있으면 각 후보의 '확인할 내용 보기'로 검토하면 돼요.",
      "같은 범위를 다시 호출하면 AI 요금이 중복될 수 있어 자동으로 다시 시도하지 않아요. 다음 예약 실행에서 새로 찾아요.",
      "같은 표시가 매일 반복되면 시스템 상태의 시스템 기록과 서버 상태를 기술 담당자에게 확인 요청해 주세요.",
    ],
  };
}

export function groupSources(group = {}) {
  return [
    ...(group.suggestion?.sources || []),
    ...(group.pendingAdditions || []).flatMap((item) => item.sources || []),
  ];
}

// 표의 상태는 묶음 자체의 상태다. 사용 중 묶음의 추가 제안은 칸 안에서 검토한다.
export function synonymTableView(groups = [], filters = {}) {
  const listed = groups.filter((group) => !isRejectedAiGroup(group));
  const counts = { all: listed.length, needs_review: 0, active: 0, off: 0 };
  for (const group of listed)
    counts[group.status] = (counts[group.status] || 0) + 1;
  const key = termKey(filters.query);
  const shown = listed.filter(
    (group) =>
      (!filters.status ||
        filters.status === "all" ||
        group.status === filters.status) &&
      (!filters.kind || group.kind === filters.kind) &&
      (!filters.document ||
        groupSources(group).some(
          (source) => source.documentName === filters.document
        )) &&
      (!key ||
        [
          ...group.terms,
          ...(group.pendingAdditions || []).flatMap((item) => item.terms || []),
        ].some((term) => termKey(term).includes(key)))
  );
  const statuses = ["needs_review", "active", "off"];
  const ordered = statuses.flatMap((status) =>
    shown.filter((group) => group.status === status)
  );
  const pages = Math.max(1, Math.ceil(ordered.length / 20));
  const page = Math.min(pages, Math.max(1, Number(filters.page) || 1));
  const rows = ordered.slice((page - 1) * 20, page * 20);
  return {
    counts,
    rows,
    page,
    pages,
    total: ordered.length,
    start: ordered.length ? (page - 1) * 20 + 1 : 0,
    end: Math.min(page * 20, ordered.length),
    documents: [
      ...new Set(
        listed
          .flatMap(groupSources)
          .map((source) => source.documentName)
          .filter(Boolean)
      ),
    ].sort(),
    sections: statuses
      .map((status) => ({
        status,
        groups: rows.filter((group) => group.status === status),
      }))
      .filter((section) => section.groups.length),
  };
}

export async function reviewSelectedGroups(groups, ids, approve, api) {
  const selected = new Set(ids);
  const completed = [];
  const failed = [];
  for (const group of groups.filter(
    (item) => selected.has(item.id) && item.status === "needs_review"
  )) {
    try {
      const problem = approve
        ? validateTerms(group.terms, groups, { ...group, terms: [] })
        : "";
      if (problem) {
        failed.push({ id: group.id, error: problem });
        continue;
      }
      const result = isNewAiGroup(group)
        ? await (approve
            ? api.approveAddition(group.suggestion.id)
            : api.dismissAddition(group.suggestion.id))
        : await api.update(group.id, { status: approve ? "active" : "off" });
      if (result.ok && result.success) completed.push(group.id);
      else
        failed.push({
          id: group.id,
          error: result.error || "처리하지 못했어요.",
        });
    } catch {
      failed.push({ id: group.id, error: "서버에 연결하지 못했어요." });
    }
  }
  return { completed, failed };
}

export async function saveSynonymGroup(group, terms, kind, status, api) {
  const pending = group.status === "needs_review";
  const proposal = isNewAiGroup(group);
  const saved = await api.update(group.id, {
    terms: terms.map(cleanTerm).filter(Boolean),
    kind,
    ...(!proposal ? { status: pending ? "active" : status } : {}),
  });
  if (!saved.ok || !saved.success || !proposal) return saved;
  try {
    const approved = await api.approveAddition(group.suggestion.id);
    if (approved.ok && approved.success) return approved;
    return {
      ...approved,
      success: false,
      error: `수정 내용은 저장됐지만 등록에 실패했어요. 검토 대기 목록에서 다시 등록해 주세요. ${approved.error || ""}`,
    };
  } catch {
    return {
      ok: false,
      success: false,
      error:
        "수정 내용은 저장됐지만 등록에 실패했어요. 서버에 다시 연결한 뒤 검토 대기 목록에서 등록해 주세요.",
    };
  }
}
