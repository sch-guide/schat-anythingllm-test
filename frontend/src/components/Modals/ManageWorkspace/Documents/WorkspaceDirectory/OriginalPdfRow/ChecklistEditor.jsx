import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash } from "@phosphor-icons/react";
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
import { isCheckableDetail, isInformationalItem } from "@/utils/checklistTree";
import {
  addLine,
  cleanItemLines,
  moveLine,
  removeLine,
  setLineCheckable,
  updateLine,
} from "@/utils/checklistLines";

const copy = (value) => JSON.parse(JSON.stringify(value));

export default function ChecklistEditor({
  checklist,
  workspaceSlug,
  isOpen,
  onClose,
  onSaved,
}) {
  const [draft, setDraft] = useState(() => copy(checklist));
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewChecks, setPreviewChecks] = useState({});
  const [previewSections, setPreviewSections] = useState({});

  useEffect(() => setDraft(copy(checklist)), [checklist]);
  if (!checklist || !draft) return null;

  const updateSection = (sectionIndex, change) =>
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section, index) =>
        index === sectionIndex ? { ...section, ...change } : section
      ),
    }));

  const updateItem = (sectionIndex, itemIndex, change) =>
    updateSection(sectionIndex, {
      items: draft.sections[sectionIndex].items.map((item, index) =>
        index === itemIndex ? { ...item, ...change } : item
      ),
    });

  const moveItem = (sectionIndex, itemIndex, direction) => {
    const items = [...draft.sections[sectionIndex].items];
    const target = itemIndex + direction;
    if (target < 0 || target >= items.length) return;
    [items[itemIndex], items[target]] = [items[target], items[itemIndex]];
    updateSection(sectionIndex, { items });
  };

  const removeItem = (sectionIndex, itemIndex) =>
    updateSection(sectionIndex, {
      items: draft.sections[sectionIndex].items.filter(
        (_, index) => index !== itemIndex
      ),
    });

  const changeLines = (sectionIndex, itemIndex, change) =>
    updateSection(sectionIndex, {
      items: draft.sections[sectionIndex].items.map((item, index) =>
        index === itemIndex ? change(item) : item
      ),
    });

  // What is saved and what the preview shows: blank lines removed.
  const cleanedSections = () =>
    draft.sections.map((section) => ({
      ...section,
      items: section.items.map(cleanItemLines),
    }));

  const addItem = (sectionIndex) =>
    updateSection(sectionIndex, {
      items: [
        ...draft.sections[sectionIndex].items,
        {
          id: `admin-item-${Date.now()}`,
          type: "checkable",
          label: "새 항목",
          details: [],
        },
      ],
    });

  async function save() {
    setSaving(true);
    try {
      const { response, data } = await Checklist.update(
        workspaceSlug,
        checklist.id,
        {
          title: draft.title,
          aliases: draft.aliases.map((alias) => alias.trim()).filter(Boolean),
          // Blank lines are not saved (their checkbox setting goes with them).
          sections: cleanedSections(),
        }
      );
      if (!response.ok || !data.success)
        throw new Error(data.error || "체크리스트를 저장하지 못했습니다.");
      toast.success("체크리스트를 저장했습니다.");
      onSaved?.(data.checklist);
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" className="z-[120]">
      <ModalHeader title="체크리스트 수정" onClose={onClose} />
      <ModalBody className="max-h-[70vh] overflow-y-auto pr-1">
        <div className="flex justify-end">
          <button
            type="button"
            aria-pressed={previewing}
            onClick={() => {
              setPreviewChecks({});
              setPreviewing((value) => !value);
            }}
            className="rounded-lg border border-sky-500 px-3 py-1.5 text-xs font-semibold text-sky-300 light:text-sky-700"
          >
            {previewing ? "수정 화면으로 돌아가기" : "직원 화면 미리보기"}
          </button>
        </div>
        {previewing ? (
          <div className="flex flex-col gap-3" data-checklist-preview="">
            <p className="m-0 text-xs text-zinc-400 light:text-slate-500">
              직원에게 보이는 모양입니다. 여기서 체크해도 저장되지 않습니다.
            </p>
            <ChecklistTree
              checklist={{ ...draft, sections: cleanedSections() }}
              checkedItems={previewChecks}
              onCheckedChange={setPreviewChecks}
              expandedSections={previewSections}
              onToggleSection={(sectionId, expanded) =>
                setPreviewSections((current) => ({
                  ...current,
                  [sectionId]: !expanded,
                }))
              }
            />
          </div>
        ) : (
          <>
            <label className="text-sm font-medium text-zinc-100 light:text-slate-800">
              제목
              <input
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm light:border-slate-300 light:bg-white"
              />
            </label>
            <label className="text-sm font-medium text-zinc-100 light:text-slate-800">
              찾는 이름 (쉼표로 구분)
              <input
                aria-label="찾는 이름"
                value={draft.aliases.join(", ")}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    aliases: event.target.value.split(","),
                  }))
                }
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm light:border-slate-300 light:bg-white"
              />
              <span className="mt-1 block text-xs font-normal text-zinc-400 light:text-slate-500">
                직원 질문에 이 이름이 있으면 체크리스트가 나옵니다.
              </span>
            </label>
            {draft.sections.map((section, sectionIndex) => (
              <section
                key={section.id}
                className="rounded-lg border border-zinc-700 p-3 light:border-slate-300"
              >
                <input
                  aria-label="섹션 제목"
                  value={section.title}
                  onChange={(event) =>
                    updateSection(sectionIndex, { title: event.target.value })
                  }
                  className="mb-3 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-semibold light:border-slate-300 light:bg-white"
                />
                <div className="flex flex-col gap-3">
                  {section.items.map((item, itemIndex) => (
                    <div
                      key={item.id}
                      className="rounded border border-zinc-800 p-3 light:border-slate-200"
                    >
                      <div className="flex gap-2">
                        <select
                          aria-label="항목 종류"
                          value={item.type}
                          onChange={(event) =>
                            updateItem(sectionIndex, itemIndex, {
                              type: event.target.value,
                            })
                          }
                          className="rounded border border-zinc-700 bg-zinc-800 px-2 text-xs light:border-slate-300 light:bg-white"
                        >
                          <option value="informational">설명</option>
                          <option value="checkable">체크</option>
                        </select>
                        <input
                          aria-label="항목 제목"
                          value={item.label}
                          onChange={(event) =>
                            updateItem(sectionIndex, itemIndex, {
                              label: event.target.value,
                            })
                          }
                          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm light:border-slate-300 light:bg-white"
                        />
                        <button
                          type="button"
                          aria-label="위로"
                          onClick={() => moveItem(sectionIndex, itemIndex, -1)}
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label="아래로"
                          onClick={() => moveItem(sectionIndex, itemIndex, 1)}
                        >
                          <ArrowDown size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label="항목 삭제"
                          onClick={() => removeItem(sectionIndex, itemIndex)}
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {isInformationalItem(item) && (
                          <p className="m-0 text-xs text-zinc-400 light:text-slate-500">
                            설명 항목이라 직원 화면에 체크박스가 없습니다.
                          </p>
                        )}
                        {item.details.map((line, lineIndex) => (
                          <div
                            key={`${item.id}-line-${lineIndex}`}
                            className="flex items-center gap-2"
                            data-checklist-line=""
                          >
                            <label
                              className="flex shrink-0 items-center gap-1 text-xs text-zinc-300 light:text-slate-600"
                              title="직원 화면에서 이 줄에 체크박스를 표시합니다"
                            >
                              <input
                                type="checkbox"
                                aria-label={`${lineIndex + 1}번째 줄 체크박스 표시`}
                                disabled={isInformationalItem(item)}
                                checked={
                                  !isInformationalItem(item) &&
                                  isCheckableDetail(item, lineIndex)
                                }
                                onChange={(event) =>
                                  changeLines(
                                    sectionIndex,
                                    itemIndex,
                                    (current) =>
                                      setLineCheckable(
                                        current,
                                        lineIndex,
                                        event.target.checked
                                      )
                                  )
                                }
                                className="h-4 w-4 accent-sky-600"
                              />
                              체크
                            </label>
                            <input
                              aria-label={`${item.label} ${lineIndex + 1}번째 줄`}
                              value={line}
                              onChange={(event) =>
                                changeLines(
                                  sectionIndex,
                                  itemIndex,
                                  (current) =>
                                    updateLine(
                                      current,
                                      lineIndex,
                                      event.target.value
                                    )
                                )
                              }
                              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm light:border-slate-300 light:bg-white"
                            />
                            <button
                              type="button"
                              aria-label="줄 위로"
                              onClick={() =>
                                changeLines(
                                  sectionIndex,
                                  itemIndex,
                                  (current) => moveLine(current, lineIndex, -1)
                                )
                              }
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              type="button"
                              aria-label="줄 아래로"
                              onClick={() =>
                                changeLines(
                                  sectionIndex,
                                  itemIndex,
                                  (current) => moveLine(current, lineIndex, 1)
                                )
                              }
                            >
                              <ArrowDown size={14} />
                            </button>
                            <button
                              type="button"
                              aria-label="줄 삭제"
                              onClick={() =>
                                changeLines(
                                  sectionIndex,
                                  itemIndex,
                                  (current) => removeLine(current, lineIndex)
                                )
                              }
                            >
                              <Trash size={14} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            changeLines(sectionIndex, itemIndex, addLine)
                          }
                          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-sky-300 light:text-sky-700"
                        >
                          <Plus size={12} /> 줄 추가
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => addItem(sectionIndex)}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-sky-300 light:text-sky-700"
                >
                  <Plus size={14} /> 항목 추가
                </button>
              </section>
            ))}
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton type="button" onClick={onClose}>
          취소
        </ModalSecondaryButton>
        <ModalPrimaryButton type="button" disabled={saving} onClick={save}>
          {saving ? "저장 중..." : "저장"}
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}
