import { useMemo, useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import Modal, {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalSecondaryButton,
} from "@/components/lib/Modal";

export function ChecklistBody({ checklist, checkedItems, onToggleItem }) {
  const initialSections = useMemo(
    () =>
      Object.fromEntries(
        (checklist?.sections || []).map((section) => [section.id, true])
      ),
    [checklist]
  );
  const [expandedSections, setExpandedSections] = useState(initialSections);

  return (checklist?.sections || []).map((section) => {
    const expanded = expandedSections[section.id] !== false;
    return (
      <section
        key={section.id}
        className="rounded-lg border border-zinc-700 light:border-slate-200 bg-zinc-900 light:bg-white"
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() =>
            setExpandedSections((current) => ({
              ...current,
              [section.id]: !expanded,
            }))
          }
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-base font-semibold text-zinc-50 light:text-slate-900"
        >
          <span>{section.title}</span>
          {expanded ? <CaretDown size={18} /> : <CaretRight size={18} />}
        </button>
        {expanded && (
          <div className="flex flex-col gap-5 border-t border-zinc-700 light:border-slate-200 px-4 py-4">
            {section.items.map((item) => {
              const isCheckable = item.type === "checkable";
              return (
                <div key={item.id} className="flex items-start gap-3">
                  {isCheckable && (
                    <input
                      type="checkbox"
                      checked={Boolean(checkedItems[item.id])}
                      onChange={() => onToggleItem(item.id)}
                      aria-label={item.label}
                      className="mt-1 h-5 w-5 shrink-0 accent-sky-600"
                    />
                  )}
                  <div className="min-w-0">
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
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  });
}

export default function ChecklistModal({
  checklist,
  isOpen,
  onClose,
  checkedItems,
  onToggleItem,
}) {
  if (!checklist) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" className="z-[110]">
      <ModalHeader
        title={`${checklist.title} 체크리스트`}
        subtitle={`${checklist.source?.filename || ""} · p.${checklist.source?.page || "-"}`}
        onClose={onClose}
      />
      <ModalBody className="max-h-[70vh] overflow-y-auto pr-1">
        <ChecklistBody
          checklist={checklist}
          checkedItems={checkedItems}
          onToggleItem={onToggleItem}
        />
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton type="button" onClick={onClose}>
          닫기
        </ModalSecondaryButton>
      </ModalFooter>
    </Modal>
  );
}
