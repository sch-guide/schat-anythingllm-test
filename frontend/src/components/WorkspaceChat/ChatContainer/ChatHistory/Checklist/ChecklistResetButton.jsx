import { ArrowCounterClockwise } from "@phosphor-icons/react";

// Saved checks stay until cleared here, e.g. before the next patient.
export default function ChecklistResetButton({ checkedItems = {}, onReset }) {
  const hasChecks = Object.values(checkedItems).some(Boolean);
  return (
    <button
      type="button"
      disabled={!hasChecks}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => {
        if (window.confirm("이 체크리스트의 체크를 모두 해제할까요?"))
          onReset?.();
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/10 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent light:text-sky-700"
    >
      <ArrowCounterClockwise size={14} />
      체크 모두 해제
    </button>
  );
}
