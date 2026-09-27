import { ArrowSquareOut, CheckSquare } from "@phosphor-icons/react";

// Button text from the checklist's own title (e.g. "신루설치술 PCN").
// The verified Renal biopsy checklist keeps its established wording.
export function checklistButtonLabel(checklist = {}) {
  const title = String(checklist.title || "").trim();
  if (/renal\s*biopsy/iu.test(title)) return "Renal biopsy 체크리스트 보기";
  return `${title || "검사"} 체크리스트 보기`;
}

export default function ChecklistLauncher({
  checklists = [],
  onOpenChecklist,
}) {
  if (!checklists.length) return null;

  return (
    <div className="mt-5 flex w-full max-w-[780px] flex-col items-start gap-2">
      {checklists.map((checklist) => (
        <div key={checklist.id} className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenChecklist?.(checklist.id)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sky-500/50 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-200 transition-colors hover:bg-sky-500/20 light:text-sky-800"
          >
            <CheckSquare size={18} weight="bold" />
            {checklistButtonLabel(checklist)}
          </button>
          <button
            type="button"
            onClick={() => onOpenChecklist?.(checklist.id, "window")}
            className="hidden min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sky-300 transition-colors hover:bg-sky-500/10 light:text-sky-700 md:inline-flex"
          >
            <ArrowSquareOut size={16} />
            별도 창으로 열기
          </button>
        </div>
      ))}
    </div>
  );
}
