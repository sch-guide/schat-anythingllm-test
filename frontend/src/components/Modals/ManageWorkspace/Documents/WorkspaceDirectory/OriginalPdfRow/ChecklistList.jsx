import { useState } from "react";
import ChecklistControls from "./ChecklistControls";

/**
 * Lists every automatic checklist of one PDF under its document row and reuses
 * the existing view / edit / original-page controls for each of them. There is
 * no approval step: "검토 필요" only marks checklists hidden from employees
 * because automatic source verification failed.
 */
export default function ChecklistList({
  checklists = [],
  workspaceSlug,
  onUpdated,
}) {
  const [expanded, setExpanded] = useState(false);
  if (!checklists.length) return null;
  const reviewCount = checklists.filter(
    (checklist) => checklist.status === "needs_review"
  ).length;

  return (
    <div className="mt-1 text-[10px]">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((value) => !value);
        }}
        className="rounded border border-theme-modal-border px-2 py-1 hover:bg-theme-file-picker-hover"
      >
        체크리스트 {checklists.length}개
        {reviewCount > 0 ? ` · 검토 필요 ${reviewCount}개` : ""}{" "}
        {expanded ? "▲" : "▼"}
      </button>
      {expanded && (
        <ul className="mt-1 flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
          {checklists.map((checklist) => (
            <li
              key={checklist.id}
              className="rounded border border-theme-modal-border px-2 py-1"
            >
              <p className="m-0 truncate font-medium">
                p.{checklist.source?.page || "-"} · {checklist.title}
                {checklist.status === "hidden" && (
                  <span className="ml-1 rounded bg-zinc-500/20 px-1">숨김</span>
                )}
                {checklist.status === "needs_review" && (
                  <span className="ml-1 rounded bg-amber-500/20 px-1 text-amber-700 light:text-amber-800">
                    검토 필요
                  </span>
                )}
              </p>
              <ChecklistControls
                checklist={checklist}
                workspaceSlug={workspaceSlug}
                onUpdated={onUpdated}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
