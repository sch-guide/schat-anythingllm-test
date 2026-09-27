import { useEffect, useRef } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import {
  detailKey,
  isInformationalItem,
  isNoteDetail,
  parentState,
  toggleDetail,
  toggleParent,
} from "@/utils/checklistTree";

function ParentCheckbox({ state, label, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "indeterminate";
  }, [state]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "checked"}
      aria-checked={state === "indeterminate" ? "mixed" : state === "checked"}
      onChange={onChange}
      aria-label={`${label} 전체`}
      data-checklist-parent=""
      className="mt-1 h-5 w-5 shrink-0 accent-sky-600"
    />
  );
}

function InformationalItem({ item }) {
  return (
    <div data-checklist-info="" className="min-w-0 pl-8">
      <p className="m-0 text-sm font-semibold leading-[1.7] text-zinc-100 light:text-slate-900">
        {item.label}
      </p>
      <div className="mt-1 flex flex-col gap-1">
        {item.details.map((detail, index) => (
          <p
            key={`${item.id}-detail-${index}`}
            className="m-0 whitespace-pre-wrap break-words text-sm leading-[1.7] text-zinc-300 light:text-slate-700"
          >
            {detail}
          </p>
        ))}
      </div>
    </div>
  );
}

function NoteDetail({ detail }) {
  return (
    <p
      data-checklist-note=""
      className="m-0 min-w-0 whitespace-pre-wrap break-words pl-7 text-xs leading-[1.7] text-zinc-400 light:text-slate-500"
    >
      {detail}
    </p>
  );
}

function CheckableItem({ scope, item, checkedItems, onCheckedChange }) {
  const state = parentState(scope, item, checkedItems);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label className="flex cursor-pointer items-start gap-3">
        <ParentCheckbox
          state={state}
          label={item.label}
          onChange={() =>
            onCheckedChange(toggleParent(scope, item, checkedItems))
          }
        />
        <span className="min-w-0 text-sm font-semibold leading-[1.7] text-zinc-100 light:text-slate-900">
          {item.label}
        </span>
      </label>
      {item.details.length > 0 && (
        <div className="flex flex-col gap-1 pl-8">
          {item.details.map((detail, index) => {
            if (isNoteDetail(detail))
              return (
                <NoteDetail
                  key={`${item.id}-detail-${index}`}
                  detail={detail}
                />
              );
            const checked = Boolean(
              checkedItems[detailKey(scope, item.id, index)]
            );
            return (
              <label
                key={`${item.id}-detail-${index}`}
                className="flex cursor-pointer items-start gap-3"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onCheckedChange(
                      toggleDetail(scope, item, index, checkedItems)
                    )
                  }
                  aria-label={detail}
                  data-checklist-child=""
                  className="mt-1 h-4 w-4 shrink-0 accent-sky-600"
                />
                <span
                  data-checklist-child-text=""
                  className={`min-w-0 whitespace-pre-wrap break-words text-sm leading-[1.7] ${
                    checked
                      ? "text-zinc-500 line-through light:text-slate-400"
                      : "text-zinc-300 light:text-slate-700"
                  }`}
                >
                  {detail}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Employee checklist tree. Fully controlled so the floating panel and the
 * separate popup window can keep checks and fold state until the user closes.
 */
export default function ChecklistTree({
  checklist,
  checkedItems = {},
  onCheckedChange,
  expandedSections = {},
  onToggleSection,
}) {
  return (checklist?.sections || []).map((section) => {
    const expanded = expandedSections[section.id] !== false;
    return (
      <section
        key={section.id}
        className="rounded-lg border border-zinc-700 bg-zinc-900 light:border-slate-200 light:bg-white"
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => onToggleSection(section.id, expanded)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-base font-semibold text-zinc-50 light:text-slate-900"
        >
          <span>{section.title}</span>
          {expanded ? <CaretDown size={18} /> : <CaretRight size={18} />}
        </button>
        {expanded && (
          <div className="flex flex-col gap-5 border-t border-zinc-700 px-4 py-4 light:border-slate-200">
            {section.items.map((item) =>
              isInformationalItem(item) ? (
                <InformationalItem key={item.id} item={item} />
              ) : (
                <CheckableItem
                  key={item.id}
                  scope={{ checklistId: checklist.id, sectionId: section.id }}
                  item={item}
                  checkedItems={checkedItems}
                  onCheckedChange={onCheckedChange}
                />
              )
            )}
          </div>
        )}
      </section>
    );
  });
}
