import { Printer } from "@phosphor-icons/react";
import { printChecklist } from "@/utils/checklistPrint";

export default function ChecklistPrintButton({ checklist, checkedItems, patientInfo, otherMemo, disabled }) {
  return (
    <button type="button" disabled={disabled} onClick={() => printChecklist(checklist, checkedItems, {patient:patientInfo, other:otherMemo})}
      className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 light:text-slate-600 light:hover:bg-slate-100"
      aria-label="체크리스트 인쇄">
      <Printer size={15} /> 인쇄
    </button>
  );
}
