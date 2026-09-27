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
          aliases: draft.aliases,
          sections: draft.sections,
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
        <label className="text-sm font-medium text-zinc-100 light:text-slate-800">
          제목
          <input
            value={draft.title}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm light:border-slate-300 light:bg-white"
          />
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
                  <textarea
                    aria-label={`${item.label} 세부 설명`}
                    value={item.details.join("\n")}
                    onChange={(event) =>
                      updateItem(sectionIndex, itemIndex, {
                        details: event.target.value.split("\n"),
                      })
                    }
                    rows={3}
                    className="mt-2 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm leading-relaxed light:border-slate-300 light:bg-white"
                  />
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
