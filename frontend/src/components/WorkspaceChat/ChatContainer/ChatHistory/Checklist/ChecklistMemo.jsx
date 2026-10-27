import { useLayoutEffect, useRef } from "react";
import { checklistTone } from "./checklistTone";

// compact (환자정보): one line, 52px, grows with the text up to ~3 lines.
// Default (기타메모): the large 3-row box, resizable by hand.
const COMPACT_MIN = 52;
const COMPACT_MAX = 100;

// Free-text note card (환자정보 above the checklist, 기타메모 below). Same
// card look as the blue checklist sections. The text stays in this browser
// only (useChecklistMemo); 체크 모두 해제 does not touch it, 지우기 does.
export default function ChecklistMemo({
  id,
  title,
  placeholder,
  hint = "",
  value = "",
  onChange,
  onBlur,
  compact = false,
}) {
  const colors = checklistTone("blue");
  const hasText = value.trim().length > 0;
  const fieldRef = useRef(null);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!compact || !field) return;
    field.style.height = "auto";
    const height = Math.min(
      COMPACT_MAX,
      Math.max(COMPACT_MIN, field.scrollHeight + 2)
    );
    field.style.height = `${height}px`;
    field.style.overflowY =
      field.scrollHeight + 2 > COMPACT_MAX ? "auto" : "hidden";
  }, [compact, value]);
  return (
    <section
      data-checklist-memo={id}
      className={`shrink-0 rounded-lg border ${colors.card}`}
    >
      <div
        className={`flex items-center justify-between gap-3 px-4 py-3 ${colors.header}`}
      >
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <label
            htmlFor={`checklist-memo-${id}`}
            className="m-0 text-base font-semibold"
          >
            {title}
          </label>
          {hint && (
            <span
              data-checklist-memo-hint
              className="text-xs font-normal text-orange-500"
            >
              {hint}
            </span>
          )}
        </div>
        {hasText && (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              if (window.confirm(`${title}를 지울까요?`)) onChange?.("");
            }}
            className="shrink-0 rounded px-2 py-0.5 text-xs font-medium hover:bg-blue-500/10"
          >
            지우기
          </button>
        )}
      </div>
      <div
        className={`border-t px-4 ${compact ? "py-2.5" : "py-3"} ${colors.divider}`}
      >
        <textarea
          ref={fieldRef}
          id={`checklist-memo-${id}`}
          value={value}
          rows={compact ? 1 : 3}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={onBlur}
          onKeyDown={(event) => {
            // 환자정보(한 줄): 엔터를 누르면 줄을 바꾸지 않고 바로 이름 가운데를 가려 저장한다
            // (2026-10-27). 한글 입력이 끝나기 전(조합 중) 엔터와 Shift+엔터는 그대로 둔다.
            if (!compact || event.key !== "Enter" || event.shiftKey) return;
            if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            onBlur?.();
          }}
          className={`block w-full min-w-0 rounded-md ${compact ? "h-[52px] min-h-[52px] resize-none py-[13px]" : "min-h-[88px] resize-y py-2"} border border-blue-400/40 bg-zinc-800/60 px-3 text-base leading-6 text-zinc-100 placeholder:text-zinc-500 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30 light:border-blue-200 light:bg-white light:text-slate-900 light:placeholder:text-slate-400 light:focus:border-blue-500 md:text-sm`}
        />
      </div>
    </section>
  );
}
