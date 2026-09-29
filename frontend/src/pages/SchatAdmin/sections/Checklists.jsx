import { useCallback, useEffect, useMemo, useState } from "react";
import Checklist from "@/models/checklist";
import showToast from "@/utils/toast";
import ChecklistControls from "@/components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/OriginalPdfRow/ChecklistControls";
import { Badge, Card, Loading, Notice, inputClass } from "../ui";

// "체크리스트 관리": every checklist of the workspace with its source page.
// Only "공개" is shown to employees; "검토 필요" and "숨김" never are.

export const CHECKLIST_STATUS_LABELS = {
  needs_review: { text: "검토 필요", tone: "warning" },
  active: { text: "공개", tone: "ok" },
  hidden: { text: "숨김", tone: "neutral" },
};

const REASON_TEXT = {
  "nested-layout":
    "칸 안에 표가 한 번 더 있어 자동으로 읽은 순서를 확인해야 합니다.",
  "duplicate-detail": "같은 내용이 두 번 읽혔습니다.",
  "auto-generated":
    "문서를 올릴 때 자동으로 만들어져 확인을 기다립니다. (원문 자동 대조는 통과)",
  "draft-nonstandard-page":
    "표준 양식이 아닌 쪽이라 지침서 줄을 그대로 옮긴 초안입니다.",
  "title-not-in-source": "제목이 원문과 다릅니다.",
  "alias-not-in-source": "찾는 이름이 원문과 다릅니다.",
  "label-order-or-missing": "항목 이름이나 순서가 원문과 다릅니다.",
  "detail-order-or-missing": "세부 내용이나 순서가 원문과 다릅니다.",
};

export function reviewReasonText(code = "") {
  return REASON_TEXT[code] || "자동 대조에서 확인이 필요한 부분이 있습니다.";
}

export function filterChecklists(
  checklists = [],
  { status = "all", query = "" } = {}
) {
  const needle = String(query).trim().toLocaleLowerCase().replace(/\s+/g, "");
  return checklists
    .filter((checklist) => status === "all" || checklist.status === status)
    .filter((checklist) => {
      if (!needle) return true;
      const haystack = [checklist.title, ...(checklist.aliases || [])]
        .join(" ")
        .toLocaleLowerCase()
        .replace(/\s+/g, "");
      return (
        haystack.includes(needle) || `p.${checklist.source?.page}` === needle
      );
    })
    .sort(
      (a, b) =>
        String(a.source?.filename).localeCompare(String(b.source?.filename)) ||
        Number(a.source?.page || 0) - Number(b.source?.page || 0)
    );
}

const FILTERS = [
  ["all", "전체"],
  ["needs_review", "검토 필요"],
  ["active", "공개"],
  ["hidden", "숨김"],
];

export default function ChecklistsSection({ slug }) {
  const [checklists, setChecklists] = useState(null);
  const [status, setStatus] = useState("needs_review");
  const [query, setQuery] = useState("");
  const [changing, setChanging] = useState(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setChecklists(await Checklist.list(slug, { scope: "admin" }));
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const result = { all: 0, needs_review: 0, active: 0, hidden: 0 };
    for (const checklist of checklists || []) {
      result.all += 1;
      result[checklist.status] = (result[checklist.status] || 0) + 1;
    }
    return result;
  }, [checklists]);

  async function changeStatus(checklist, next) {
    if (next === checklist.status) return;
    if (
      next === "active" &&
      !window.confirm(
        `"${checklist.title}" 체크리스트를 공개하면 직원 화면에 바로 나옵니다. 원문과 확인하셨나요?`
      )
    )
      return;
    setChanging(checklist.id);
    const { response, data } = await Checklist.setStatus(
      slug,
      checklist.id,
      next
    );
    setChanging(null);
    if (!response.ok || !data.success) {
      showToast("상태를 바꾸지 못했습니다.", "error");
      return;
    }
    showToast(
      `"${checklist.title}" → ${CHECKLIST_STATUS_LABELS[next].text}`,
      "success"
    );
    setChecklists((current) =>
      current.map((item) => (item.id === checklist.id ? data.checklist : item))
    );
  }

  if (!slug) return <Loading />;
  if (checklists === null) return <Loading />;
  const shown = filterChecklists(checklists, { status, query });

  return (
    <div className="flex flex-col gap-y-5">
      <Notice>
        직원 화면에는 <b>공개</b> 상태만 나옵니다. <b>검토 필요</b>와{" "}
        <b>숨김</b>은 관리자만 볼 수 있습니다. 원본 쪽을 열어 내용을 확인한 뒤
        공개해 주세요. 수정한 내용과 상태는 문서를 다시 올려도 덮어쓰지
        않습니다.
      </Notice>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={status === key}
              onClick={() => setStatus(key)}
              className={`rounded-full border px-3 py-1 text-sm ${
                status === key
                  ? "border-sky-500 bg-sky-500/15 font-semibold text-theme-text-primary"
                  : "border-theme-sidebar-border text-theme-text-secondary"
              }`}
            >
              {label} {counts[key] || 0}
            </button>
          ))}
          <input
            aria-label="체크리스트 검색"
            placeholder="이름 또는 p.쪽수로 찾기"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={`${inputClass} md:ml-auto md:w-64`}
          />
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-theme-text-secondary">
            해당하는 체크리스트가 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-y-2">
            {shown.map((checklist) => {
              const label = CHECKLIST_STATUS_LABELS[checklist.status];
              return (
                <li
                  key={checklist.id}
                  className="schat-admin-checklist rounded-lg border border-theme-sidebar-border px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-sm font-semibold text-theme-text-primary">
                        p.{checklist.source?.page || "-"} · {checklist.title}{" "}
                        <Badge tone={label.tone}>{label.text}</Badge>
                        {checklist.draft && (
                          <span className="ml-1">
                            <Badge tone="neutral">초안</Badge>
                          </span>
                        )}
                      </p>
                      <p className="m-0 mt-0.5 text-xs text-theme-text-secondary">
                        근거: {checklist.source?.filename || "-"} p.
                        {checklist.source?.page || "-"} · 찾는 이름:{" "}
                        {(checklist.aliases || []).join(", ")}
                      </p>
                      {checklist.status !== "active" &&
                        (checklist.reviewReasons || []).length > 0 && (
                          <ul className="m-0 mt-1 list-disc pl-4 text-xs text-theme-text-secondary">
                            {checklist.reviewReasons.map((code) => (
                              <li key={code}>{reviewReasonText(code)}</li>
                            ))}
                            {checklist.reviewNote && (
                              <li>{checklist.reviewNote}</li>
                            )}
                          </ul>
                        )}
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-theme-text-secondary">
                      상태
                      <select
                        aria-label={`${checklist.title} 상태`}
                        value={checklist.status}
                        disabled={changing === checklist.id}
                        onChange={(event) =>
                          changeStatus(checklist, event.target.value)
                        }
                        className="rounded-lg border border-theme-sidebar-border bg-theme-settings-input-bg px-2 py-1 text-sm text-theme-text-primary"
                      >
                        {Object.entries(CHECKLIST_STATUS_LABELS).map(
                          ([value, item]) => (
                            <option key={value} value={value}>
                              {item.text}
                            </option>
                          )
                        )}
                      </select>
                    </label>
                  </div>
                  <ChecklistControls
                    checklist={checklist}
                    workspaceSlug={slug}
                    onUpdated={(updated) =>
                      updated &&
                      setChecklists((current) =>
                        current.map((item) =>
                          item.id === updated.id ? updated : item
                        )
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
