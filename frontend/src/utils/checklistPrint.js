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
@page { size: A4 portrait; margin: 0 ${PAGE_MARGIN_MM}mm; }
.sheet { width: 100%; border-collapse: collapse; }
.sheet td { padding: 0; }
.space { height: ${PAGE_MARGIN_MM}mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #111; background: white; font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; font-size: 9.5pt; line-height: 1.4; overflow-wrap: anywhere; }
h1 { font-size: 13pt; margin: 0 0 3mm; }
h2 { font-size: 11pt; border-bottom: 1px solid #777; margin: 3mm 0 1.5mm; padding-bottom: 0.5mm; break-after: avoid; page-break-after: avoid; }
h3 { font-size: 9.5pt; font-weight: 600; margin: 1.5mm 0 0.5mm; break-after: avoid; page-break-after: avoid; }
p { margin: 0.5mm 0; white-space: pre-wrap; orphans: 2; widows: 2; }
.line { padding-left: 6mm; position: relative; }
.box { position: absolute; left: 0; font-family: "Segoe UI Symbol", "Apple Symbols", sans-serif; }
.checked { text-decoration: line-through; }
.note { margin-left: 6mm; }
.memo { white-space: pre-wrap; }
</style></head><body><table class="sheet"><thead><tr><td><div class="space"></div></td></tr></thead><tfoot><tr><td><div class="space"></div></td></tr></tfoot><tbody><tr><td><h1>${escape(checklist?.title)} 체크리스트</h1>${note("환자정보",maskChecklistPatient(memo.patient))}${sections}${note("기타메모",maskChecklistOther(memo.other))}</td></tr></tbody></table></body></html>`;
}

// 2026-10-17 사용자 요청: 브라우저가 위·아래 여백에 넣는 주소·날짜(머리글/바닥글)가 나오지 않게
// 종이의 위·아래 여백은 0으로 두고, 쪽마다 반복되는 빈 줄(thead/tfoot)로 여백을 만든다.
// 2026-10-17 사용자 요청: 가능하면 A4 한 장에 인쇄. 간격을 줄이고, 그래도 넘치면
// 글자를 읽을 수 있는 크기(MIN_SCALE)까지 전체를 줄인다. 그보다 길면 두 장으로 나눈다.
const PAGE_MARGIN_MM = 10;
const MIN_SCALE = 0.6;
const MM_TO_PX = 96 / 25.4;
/** 한 장 높이에 맞추는 배율(1 이하, MIN_SCALE 이상). */
export function onePageScale(contentHeightPx) {
  // 잰 높이에 위·아래 빈 줄(여백)이 이미 들어 있으므로 종이 전체 높이와 비교한다.
  const available = 297 * MM_TO_PX - 4;
  if (!(contentHeightPx > available)) return 1;
  const scale = available / contentHeightPx;
  return scale < MIN_SCALE ? MIN_SCALE : Math.floor(scale * 100) / 100;
}
export function fitChecklistToOnePage(doc) {
  const body = doc?.body;
  if (!body) return 1;
  body.style.zoom = "1";
  const scale = onePageScale(body.scrollHeight);
  if (scale < 1) body.style.zoom = String(scale);
  return scale;
}

// A dedicated same-origin print frame excludes chat menus, modals and scroll containers.
export function printChecklist(checklist, checkedItems, memo, ownerDocument = document) {
  ownerDocument.querySelector("iframe[data-checklist-print]")?.remove();
  const frame = ownerDocument.createElement("iframe");
  frame.dataset.checklistPrint = "";
  frame.title = "체크리스트 인쇄";
  frame.setAttribute("aria-hidden", "true");
  // 너비는 A4에서 여백을 뺀 인쇄 영역과 같게 해야 높이를 정확히 잴 수 있다.
  frame.style.cssText = `position:fixed;left:0;top:0;width:${210 - PAGE_MARGIN_MM * 2}mm;height:1px;opacity:0;pointer-events:none;border:0`;
  frame.onload = async () => {
    const view = frame.contentWindow;
    if (!view) return;
    await frame.contentDocument?.fonts?.ready;
    fitChecklistToOnePage(frame.contentDocument);
    view.addEventListener("afterprint", () => frame.remove(), {once:true});
    view.focus();
    view.print();
  };
  frame.srcdoc = buildChecklistPrintDocument(checklist, checkedItems, memo);
  ownerDocument.body.appendChild(frame);
  return frame;
}
