import { Warning } from "@phosphor-icons/react";
import { elapsedLabel } from "@/utils/checklistChecks";

// Shown when a checklist opens with checks from before, so the next patient
// does not start on someone else's ticks. It only warns; clearing stays with
// 체크 모두 해제.
export default function ChecklistLeftoverNotice({ leftover, onDismiss }) {
  if (!leftover) return null;
  const elapsed = elapsedLabel(leftover.updatedAt);
  return (
    <div
      role="status"
      className="mx-3 mb-2 flex shrink-0 items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 light:text-amber-900"
    >
      <Warning size={16} weight="bold" className="mt-px shrink-0" />
      <p className="m-0 min-w-0 flex-1 leading-5">
        이전 체크가 남아 있습니다{elapsed ? ` (${elapsed})` : ""}
      </p>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onDismiss}
        className="shrink-0 rounded px-2 py-0.5 font-medium hover:bg-amber-500/20"
      >
        확인
      </button>
    </div>
  );
}
