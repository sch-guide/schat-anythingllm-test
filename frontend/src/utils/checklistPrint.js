import {detailKey, isInformationalItem, isCheckableDetail} from "./checklistTree.js";
import {maskChecklistPatient, maskChecklistOther} from "./checklistPatientMask.js";

const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const line = (text, checked) => `<p class="line"><span class="box">${checked ? "☑" : "☐"}</span><span${checked ? ' class="checked"' : ""}>${escape(text)}</span></p>`;

// Read the current in-memory snapshot only. Never change saved checks or folds.
export function buildChecklistPrintDocument(checklist, checkedItems = {}, memo = {}) {
  const sections = (checklist?.sections || []).map(section => {
    const scope = {checklistId:checklist.id, sectionId:section.id};
    return `<section><h2>${escape(section.title)}</h2>${section.items.map(item => {
      const info = isInformationalItem(item);
      const details = item.details || [];
      const title = !info && details.length === 0
        ? line(item.label, !!checkedItems[detailKey(scope,item.id,"self")])
        : `<h3>${escape(item.label)}</h3>`;
      return `<div class="item">${title}${details.map((text,index) => !info && isCheckableDetail(item,index)
        ? line(text, !!checkedItems[detailKey(scope,item.id,index)])
        : `<p class="note">${escape(text)}</p>`).join("")}</div>`;
    }).join("")}</section>`;
  }).join("");
  const note = (title,value) => value ? `<section><h2>${title}</h2><p class="memo">${escape(value)}</p></section>` : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escape(checklist?.title)} 체크리스트</title><style>
@page { size: A4 portrait; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #111; background: white; font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; font-size: 10pt; line-height: 1.6; overflow-wrap: anywhere; }
h1 { font-size: 16pt; margin: 0 0 5mm; }
h2 { font-size: 12pt; border-bottom: 1px solid #777; margin: 5mm 0 2mm; padding-bottom: 1mm; break-after: avoid; page-break-after: avoid; }
h3 { font-size: 10pt; font-weight: 600; margin: 3mm 0 1mm; break-after: avoid; page-break-after: avoid; }
p { margin: 1mm 0; white-space: pre-wrap; orphans: 2; widows: 2; }
.line { padding-left: 6mm; position: relative; }
.box { position: absolute; left: 0; font-family: "Segoe UI Symbol", "Apple Symbols", sans-serif; }
.checked { text-decoration: line-through; }
.note { margin-left: 6mm; }
.memo { white-space: pre-wrap; }
</style></head><body><h1>${escape(checklist?.title)} 체크리스트</h1>${note("환자정보",maskChecklistPatient(memo.patient))}${sections}${note("기타메모",maskChecklistOther(memo.other))}</body></html>`;
}

// A dedicated same-origin print frame excludes chat menus, modals and scroll containers.
export function printChecklist(checklist, checkedItems, memo, ownerDocument = document) {
  ownerDocument.querySelector("iframe[data-checklist-print]")?.remove();
  const frame = ownerDocument.createElement("iframe");
  frame.dataset.checklistPrint = "";
  frame.title = "체크리스트 인쇄";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:0;top:0;width:210mm;height:1px;opacity:0;pointer-events:none;border:0";
  frame.onload = async () => {
    const view = frame.contentWindow;
    if (!view) return;
    await frame.contentDocument?.fonts?.ready;
    view.addEventListener("afterprint", () => frame.remove(), {once:true});
    view.focus();
    view.print();
  };
  frame.srcdoc = buildChecklistPrintDocument(checklist, checkedItems, memo);
  ownerDocument.body.appendChild(frame);
  return frame;
}
