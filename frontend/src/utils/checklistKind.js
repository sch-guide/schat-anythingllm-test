// 자료 분류 (검사 및 시술 / 수술 / 기타) shown on the administrator checklist
// screen. The server sends the automatic classification (autoKind), the
// administrator's choice (adminKind, or null) and the final one (kind).

export const CHECKLIST_KIND_LABELS = {
  procedure: "검사 및 시술",
  surgery: "수술",
  other: "기타",
};

export function checklistKindLabel(kind) {
  return CHECKLIST_KIND_LABELS[kind] || CHECKLIST_KIND_LABELS.other;
}

// The value of the 자료 분류 select: "auto" or one of the kinds.
export function checklistKindChoice(source = {}) {
  return CHECKLIST_KIND_LABELS[source.adminKind] ? source.adminKind : "auto";
}

export function checklistKindOptions(source = {}) {
  return [
    {
      value: "auto",
      label: `자동 분류 사용 (지금 자동 판단: ${checklistKindLabel(source.autoKind)})`,
    },
    ...Object.entries(CHECKLIST_KIND_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  ];
}

// One line for the view screen, e.g.
// "검사 및 시술 · 관리자 지정 (자동 분류: 수술)" or "수술 · 자동 분류".
export function checklistKindSummary(source = {}) {
  const admin = CHECKLIST_KIND_LABELS[source.adminKind] ? source.adminKind : null;
  if (admin)
    return `${checklistKindLabel(admin)} · 관리자 지정 (자동 분류: ${checklistKindLabel(source.autoKind)})`;
  return `${checklistKindLabel(source.kind || source.autoKind)} · 자동 분류`;
}
