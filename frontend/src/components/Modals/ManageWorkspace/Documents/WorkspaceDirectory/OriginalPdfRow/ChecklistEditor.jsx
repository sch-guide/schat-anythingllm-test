import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import Modal, {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
} from "@/components/lib/Modal";
import Checklist from "@/models/checklist";
import ChecklistTree from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistTree";
import { cleanItemLines } from "@/utils/checklistLines";
import {
  checklistKindChoice,
  checklistKindOptions,
  checklistKindSummary,
} from "@/utils/checklistKind";

const copy = (value) => JSON.parse(JSON.stringify(value));

const HEAD_BUTTON =
  "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors";

/**
 * Administrator checklist screen: "체크리스트 보기" and "수정" are one screen.
 * Both render the same ChecklistTree the employees see; editing only turns
 * each text into a field in the same place, so view → edit → save → view
 * never changes the layout.
 */
export default function ChecklistEditor({
  checklist,
  workspaceSlug,
  isOpen,
  onClose,
  onSaved,
  initialMode = "view",
  onOpenSource,
}) {
  const [shown, setShown] = useState(() => checklist);
  const [draft, setDraft] = useState(() => copy(checklist));
  const [mode, setMode] = useState(initialMode);
  const [saving, setSaving] = useState(false);
  const [checks, setChecks] = useState({});
  const [folded, setFolded] = useState({});
  // 자료 분류: "auto" (automatic) or the administrator's choice.
  const [kind, setKind] = useState(() => checklistKindChoice(checklist?.source));

  useEffect(() => {
    setShown(checklist);
    setDraft(copy(checklist));
    setKind(checklistKindChoice(checklist?.source));
  }, [checklist]);
  useEffect(() => {
    if (isOpen) setMode(initialMode);
  }, [isOpen, initialMode]);
  if (!checklist || !shown || !draft) return null;

  const editing = mode === "edit";
  const current = editing ? draft : shown;

  const updateSection = (sectionIndex, change) =>
    setDraft((value) => ({
      ...value,
      sections: value.sections.map((section, index) =>
        index === sectionIndex ? { ...section, ...change } : section
      ),
    }));

  const updateItems = (sectionIndex, change) =>
    setDraft((value) => ({
      ...value,
      sections: value.sections.map((section, index) =>
        index === sectionIndex
          ? { ...section, items: change(section.items) }
          : section
      ),
    }));

  const edit = {
    updateSection,
    updateItem: (sectionIndex, itemIndex, updater) =>
      updateItems(sectionIndex, (items) =>
        items.map((item, index) => (index === itemIndex ? updater(item) : item))
      ),
    moveItem: (sectionIndex, itemIndex, direction) =>
      updateItems(sectionIndex, (items) => {
        const target = itemIndex + direction;
        if (target < 0 || target >= items.length) return items;
        const next = [...items];
        [next[itemIndex], next[target]] = [next[target], next[itemIndex]];
        return next;
      }),
    removeItem: (sectionIndex, itemIndex) =>
      updateItems(sectionIndex, (items) =>
        items.filter((_, index) => index !== itemIndex)
      ),
    addItem: (sectionIndex) =>
      updateItems(sectionIndex, (items) => [
        ...items,
        {
          id: `admin-item-${Date.now()}`,
          type: "checkable",
          label: "새 항목",
          details: [],
        },
      ]),
  };

  function startEdit() {
    setDraft(copy(shown));
    setKind(checklistKindChoice(shown.source));
    setMode("edit");
  }

  function cancelEdit() {
    setDraft(copy(shown));
    setKind(checklistKindChoice(shown.source));
    setMode("view");
  }

  async function save() {
    setSaving(true);
    try {
      const definition = {
        title: draft.title,
        aliases: draft.aliases.map((alias) => alias.trim()).filter(Boolean),
        // Blank lines are not saved (their checkbox setting goes with them).
        sections: draft.sections.map((section) => ({
          ...section,
          items: section.items.map(cleanItemLines),
        })),
      };
      const contentChanged =
        JSON.stringify([definition.title, definition.aliases, definition.sections]) !==
        JSON.stringify([
          shown.title,
          shown.aliases,
          (shown.sections || []).map((section) => ({
            ...section,
            items: section.items.map(cleanItemLines),
          })),
        ]);
      const kindChanged = kind !== checklistKindChoice(shown.source);
      let saved = shown;
      // Changing only the 자료 분류 does not save the content, so the
      // checklist is not marked as edited by an administrator.
      if (contentChanged || !kindChanged) {
        const { response, data } = await Checklist.update(
          workspaceSlug,
          checklist.id,
          definition
        );
        if (!response.ok || !data.success)
          throw new Error(data.error || "체크리스트를 저장하지 못했습니다.");
        saved = { ...saved, ...data.checklist };
      }
      if (kindChanged) {
        const { response, data } = await Checklist.setKind(
          workspaceSlug,
          checklist.id,
          kind
        );
        if (!response.ok || !data.success)
          throw new Error("자료 분류를 바꾸지 못했습니다.");
        saved = { ...saved, ...data.checklist };
      }
      toast.success("체크리스트를 저장했습니다.");
      setShown(saved);
      setDraft(copy(saved));
      setKind(checklistKindChoice(saved.source));
      setMode("view");
      onSaved?.(saved);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  const source = checklist.source || {};

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" className="z-[120]">
      <ModalHeader
        title={editing ? "체크리스트 수정" : "체크리스트 보기"}
        subtitle={`${source.filename || ""} · p.${source.page || "-"}`}
        onClose={onClose}
      />
      <ModalBody className="max-h-[70vh] overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {source.pdfRef && onOpenSource && (
            <button
              type="button"
              onClick={onOpenSource}
              className={`${HEAD_BUTTON} border-zinc-600 text-zinc-200 light:border-slate-300 light:text-slate-700`}
            >
              원본 보기 p.{source.page}
            </button>
          )}
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              className={`${HEAD_BUTTON} border-sky-500 text-sky-300 light:text-sky-700`}
            >
              수정
            </button>
          )}
        </div>
        {editing && (
          <p className="m-0 text-xs text-zinc-400 light:text-slate-500">
            보기 화면과 같은 자리에서 글자를 고칩니다. 체크박스는 직원 화면
            모양대로 보이며, 줄 오른쪽의 &quot;체크 줄 / 설명 줄&quot;로
            바꿉니다.
          </p>
        )}
        <div className="flex flex-col gap-1" data-checklist-heading="">
          {editing ? (
            <>
              <input
                aria-label="제목"
                value={draft.title}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, title: event.target.value }))
                }
                className="w-full rounded border border-zinc-600 bg-zinc-800/70 px-1.5 text-base font-semibold leading-[1.7] text-zinc-50 light:border-slate-300 light:bg-white light:text-slate-900"
              />
              <label className="flex items-center gap-1 text-xs text-zinc-400 light:text-slate-500">
                <span className="shrink-0">찾는 이름:</span>
                <input
                  aria-label="찾는 이름"
                  value={draft.aliases.join(", ")}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      aliases: event.target.value.split(","),
                    }))
                  }
                  className="w-full rounded border border-zinc-600 bg-zinc-800/70 px-1.5 text-xs leading-[1.7] text-zinc-200 light:border-slate-300 light:bg-white light:text-slate-700"
                />
              </label>
            </>
          ) : (
            <>
              <p className="m-0 border border-transparent px-1.5 text-base font-semibold leading-[1.7] text-zinc-50 light:text-slate-900">
                {current.title}
              </p>
              <p className="m-0 border border-transparent px-1.5 text-xs leading-[1.7] text-zinc-400 light:text-slate-500">
                찾는 이름: {(current.aliases || []).join(", ")}
              </p>
            </>
          )}
          {editing ? (
            <label className="flex flex-wrap items-center gap-1 text-xs text-zinc-400 light:text-slate-500">
              <span className="shrink-0">자료 분류:</span>
              <select
                aria-label="자료 분류"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                className="rounded border border-zinc-600 bg-zinc-800/70 px-1.5 py-0.5 text-xs text-zinc-200 light:border-slate-300 light:bg-white light:text-slate-700"
              >
                {checklistKindOptions(shown.source).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="w-full">
                관리자 목록의 자료 필터와 배지에만 쓰입니다. 직원 화면과 체크리스트
                내용은 바뀌지 않습니다.
              </span>
            </label>
          ) : (
            <p
              className="m-0 border border-transparent px-1.5 text-xs leading-[1.7] text-zinc-400 light:text-slate-500"
              data-checklist-kind=""
            >
              자료 분류: {checklistKindSummary(shown.source)}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-3" data-checklist-body="">
          <ChecklistTree
            checklist={current}
            checkedItems={checks}
            onCheckedChange={setChecks}
            expandedSections={folded}
            onToggleSection={(sectionId, expanded) =>
              setFolded((value) => ({ ...value, [sectionId]: !expanded }))
            }
            edit={editing ? edit : null}
          />
        </div>
        {!editing && (
          <p className="m-0 text-xs text-zinc-400 light:text-slate-500">
            직원에게 보이는 모양과 같습니다. 여기서 체크해도 저장되지 않습니다.
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        {editing ? (
          <>
            <ModalSecondaryButton type="button" onClick={cancelEdit}>
              취소
            </ModalSecondaryButton>
            <ModalPrimaryButton type="button" disabled={saving} onClick={save}>
              {saving ? "저장 중..." : "저장"}
            </ModalPrimaryButton>
          </>
        ) : (
          <ModalSecondaryButton type="button" onClick={onClose}>
            닫기
          </ModalSecondaryButton>
        )}
      </ModalFooter>
    </Modal>
  );
}
