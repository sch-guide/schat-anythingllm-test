import { useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  CaretRight,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import {
  detailKey,
  isCheckableDetail,
  isInformationalItem,
  parentState,
  toggleDetail,
  toggleParent,
} from "@/utils/checklistTree";
import {
  addLine,
  moveLine,
  removeLine,
  setLineCheckable,
  updateLine,
} from "@/utils/checklistLines";

// In edit mode every text is replaced in place by a field with the same
// typography, so the administrator edits exactly where the text is shown.
const FIELD =
  "w-full min-w-0 resize-none overflow-hidden rounded border border-zinc-600 bg-zinc-800/70 px-1.5 py-0 text-sm leading-[1.7] text-zinc-100 light:border-slate-300 light:bg-white light:text-slate-900";
const TOOL =
  "inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100 light:text-slate-500 light:hover:bg-slate-100 light:hover:text-slate-900";

function EditableText({ value, label, onChange, className = "", note }) {
  const text = String(value ?? "");
  const ref = useRef(null);
  // Grow with the text so a long line wraps like on the read view instead of
  // hiding behind a scroll bar.
  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight + 2}px`;
  }, [text]);
  const rows = Math.max(1, text.split("\n").length);
  return (
    <textarea
      ref={ref}
      data-checklist-text=""
      aria-label={label}
      value={text}
      rows={rows}
      onChange={(event) => onChange(event.target.value)}
      className={`${FIELD} ${note ? "text-xs" : ""} ${className}`}
    />
  );
}

function Tools({ children }) {
  return (
    <span
      data-checklist-edit-tools=""
      className="flex shrink-0 items-center gap-0.5"
    >
      {children}
    </span>
  );
}

function ParentCheckbox({ state, label, onChange, disabled }) {
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
      disabled={disabled}
      aria-label={`${label} 전체`}
      data-checklist-parent=""
      className="mt-1 h-5 w-5 shrink-0 accent-sky-600"
    />
  );
}

function ItemTools({ item, edit, sectionIndex, itemIndex }) {
  const informational = isInformationalItem(item);
  return (
    <Tools>
      <button
        type="button"
        className={TOOL}
        title="직원 화면에서 체크 항목 또는 설명 항목으로 표시합니다"
        onClick={() =>
          edit.updateItem(sectionIndex, itemIndex, (current) => ({
            ...current,
            type: current.type === "checkable" ? "informational" : "checkable",
          }))
        }
      >
        {informational ? "설명 항목" : "체크 항목"}
      </button>
      <button
        type="button"
        className={TOOL}
        aria-label="항목 위로"
        onClick={() => edit.moveItem(sectionIndex, itemIndex, -1)}
      >
        <ArrowUp size={13} />
      </button>
      <button
        type="button"
        className={TOOL}
        aria-label="항목 아래로"
        onClick={() => edit.moveItem(sectionIndex, itemIndex, 1)}
      >
        <ArrowDown size={13} />
      </button>
      <button
        type="button"
        className={TOOL}
        aria-label="항목 삭제"
        onClick={() => edit.removeItem(sectionIndex, itemIndex)}
      >
        <Trash size={13} />
      </button>
    </Tools>
  );
}

function LineTools({ item, index, change, informational }) {
  const checkable = !informational && isCheckableDetail(item, index);
  return (
    <Tools>
      {!informational && (
        <button
          type="button"
          className={TOOL}
          aria-pressed={checkable}
          title="직원 화면에서 이 줄에 체크박스를 표시합니다"
          onClick={() =>
            change((current) => setLineCheckable(current, index, !checkable))
          }
        >
          {checkable ? "체크 줄" : "설명 줄"}
        </button>
      )}
      <button
        type="button"
        className={TOOL}
        aria-label="줄 위로"
        onClick={() => change((current) => moveLine(current, index, -1))}
      >
        <ArrowUp size={12} />
      </button>
      <button
        type="button"
        className={TOOL}
        aria-label="줄 아래로"
        onClick={() => change((current) => moveLine(current, index, 1))}
      >
        <ArrowDown size={12} />
      </button>
      <button
        type="button"
        className={TOOL}
        aria-label="줄 삭제"
        onClick={() => change((current) => removeLine(current, index))}
      >
        <Trash size={12} />
      </button>
    </Tools>
  );
}

function AddLineButton({ change }) {
  return (
    <button
      type="button"
      onClick={() => change(addLine)}
      className="inline-flex w-fit items-center gap-1 text-xs font-medium text-sky-300 light:text-sky-700"
    >
      <Plus size={12} /> 줄 추가
    </button>
  );
}

function InformationalItem({ item, editing, lineChange, itemTools, onLabel }) {
  return (
    <div data-checklist-info="" className="min-w-0 pl-8">
      {editing ? (
        <div className="flex items-start gap-2">
          <EditableText
            value={item.label}
            label="항목 제목"
            onChange={onLabel}
            className="font-semibold"
          />
          {itemTools}
        </div>
      ) : (
        <p
          data-checklist-text=""
          className="m-0 text-sm font-semibold leading-[1.7] text-zinc-100 light:text-slate-900"
        >
          {item.label}
        </p>
      )}
      <div className="mt-1 flex flex-col gap-1">
        {item.details.map((detail, index) =>
          editing ? (
            <div
              key={`${item.id}-detail-${index}`}
              className="flex items-start gap-2"
              data-checklist-line=""
            >
              <EditableText
                value={detail}
                label={`${item.label} ${index + 1}번째 줄`}
                onChange={(value) =>
                  lineChange((current) => updateLine(current, index, value))
                }
              />
              <LineTools
                item={item}
                index={index}
                change={lineChange}
                informational
              />
            </div>
          ) : (
            <p
              key={`${item.id}-detail-${index}`}
              data-checklist-text=""
              className="m-0 whitespace-pre-wrap break-words text-sm leading-[1.7] text-zinc-300 light:text-slate-700"
            >
              {detail}
            </p>
          )
        )}
        {editing && <AddLineButton change={lineChange} />}
      </div>
    </div>
  );
}

function NoteDetail({ detail }) {
  return (
    <p
      data-checklist-note=""
      data-checklist-text=""
      className="m-0 min-w-0 whitespace-pre-wrap break-words pl-7 text-xs leading-[1.7] text-zinc-400 light:text-slate-500"
    >
      {detail}
    </p>
  );
}

function CheckableItem({
  scope,
  item,
  checkedItems,
  onCheckedChange,
  editing,
  lineChange,
  itemTools,
  onLabel,
}) {
  const state = parentState(scope, item, checkedItems);
  const Row = editing ? "div" : "label";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Row
        className={`flex items-start gap-3 ${editing ? "" : "cursor-pointer"}`}
      >
        <ParentCheckbox
          state={state}
          label={item.label}
          disabled={editing}
          onChange={() =>
            onCheckedChange?.(toggleParent(scope, item, checkedItems))
          }
        />
        {editing ? (
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <EditableText
              value={item.label}
              label="항목 제목"
              onChange={onLabel}
              className="font-semibold"
            />
            {itemTools}
          </div>
        ) : (
          <span
            data-checklist-text=""
            className="min-w-0 text-sm font-semibold leading-[1.7] text-zinc-100 light:text-slate-900"
          >
            {item.label}
          </span>
        )}
      </Row>
      {(item.details.length > 0 || editing) && (
        <div className="flex flex-col gap-1 pl-8">
          {item.details.map((detail, index) => {
            const checkable = isCheckableDetail(item, index);
            const key = `${item.id}-detail-${index}`;
            if (editing)
              return (
                <div
                  key={key}
                  className={`flex items-start gap-3 ${checkable ? "" : "pl-7"}`}
                  data-checklist-line=""
                  {...(checkable ? {} : { "data-checklist-note": "" })}
                >
                  {checkable && (
                    <input
                      type="checkbox"
                      disabled
                      aria-label={`${detail} 체크박스`}
                      data-checklist-child=""
                      className="mt-1 h-4 w-4 shrink-0 accent-sky-600"
                    />
                  )}
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <EditableText
                      value={detail}
                      label={`${item.label} ${index + 1}번째 줄`}
                      note={!checkable}
                      onChange={(value) =>
                        lineChange((current) =>
                          updateLine(current, index, value)
                        )
                      }
                    />
                    <LineTools item={item} index={index} change={lineChange} />
                  </div>
                </div>
              );
            if (!checkable) return <NoteDetail key={key} detail={detail} />;
            const checked = Boolean(
              checkedItems[detailKey(scope, item.id, index)]
            );
            return (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-3"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onCheckedChange?.(
                      toggleDetail(scope, item, index, checkedItems)
                    )
                  }
                  aria-label={detail}
                  data-checklist-child=""
                  className="mt-1 h-4 w-4 shrink-0 accent-sky-600"
                />
                <span
                  data-checklist-child-text=""
                  data-checklist-text=""
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
          {editing && <AddLineButton change={lineChange} />}
        </div>
      )}
    </div>
  );
}

/**
 * Checklist tree shared by the employee panel/popup and the administrator
 * view and edit screens. Fully controlled so the floating panel and the
 * separate popup window can keep checks and fold state until the user closes.
 *
 * `edit` (administrator only) switches every text to an in-place field at the
 * same position; the hierarchy, order, checkboxes and indentation stay the
 * same as the read view. It provides updateSection(sectionIndex, change),
 * updateItem(sectionIndex, itemIndex, updater), moveItem(sectionIndex,
 * itemIndex, direction), removeItem(sectionIndex, itemIndex) and
 * addItem(sectionIndex).
 */
export default function ChecklistTree({
  checklist,
  checkedItems = {},
  onCheckedChange,
  expandedSections = {},
  onToggleSection,
  edit = null,
}) {
  const editing = Boolean(edit);
  return (checklist?.sections || []).map((section, sectionIndex) => {
    const expanded = editing || expandedSections[section.id] !== false;
    return (
      <section
        key={section.id}
        className="rounded-lg border border-zinc-700 bg-zinc-900 light:border-slate-200 light:bg-white"
      >
        {editing ? (
          <div className="flex w-full items-center gap-3 px-4 py-3">
            <input
              aria-label="섹션 제목"
              value={section.title}
              onChange={(event) =>
                edit.updateSection(sectionIndex, { title: event.target.value })
              }
              className={`${FIELD} text-base font-semibold text-zinc-50`}
            />
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => onToggleSection?.(section.id, expanded)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-base font-semibold text-zinc-50 light:text-slate-900"
          >
            <span>{section.title}</span>
            {expanded ? <CaretDown size={18} /> : <CaretRight size={18} />}
          </button>
        )}
        {expanded && (
          <div className="flex flex-col gap-5 border-t border-zinc-700 px-4 py-4 light:border-slate-200">
            {section.items.map((item, itemIndex) => {
              const editProps = editing
                ? {
                    editing,
                    lineChange: (updater) =>
                      edit.updateItem(sectionIndex, itemIndex, updater),
                    onLabel: (value) =>
                      edit.updateItem(sectionIndex, itemIndex, (current) => ({
                        ...current,
                        label: value,
                      })),
                    itemTools: (
                      <ItemTools
                        item={item}
                        edit={edit}
                        sectionIndex={sectionIndex}
                        itemIndex={itemIndex}
                      />
                    ),
                  }
                : {};
              return isInformationalItem(item) ? (
                <InformationalItem key={item.id} item={item} {...editProps} />
              ) : (
                <CheckableItem
                  key={item.id}
                  scope={{ checklistId: checklist.id, sectionId: section.id }}
                  item={item}
                  checkedItems={checkedItems}
                  onCheckedChange={onCheckedChange}
                  {...editProps}
                />
              );
            })}
            {editing && (
              <button
                type="button"
                onClick={() => edit.addItem(sectionIndex)}
                className="inline-flex w-fit items-center gap-1 text-xs font-medium text-sky-300 light:text-sky-700"
              >
                <Plus size={14} /> 항목 추가
              </button>
            )}
          </div>
        )}
      </section>
    );
  });
}
