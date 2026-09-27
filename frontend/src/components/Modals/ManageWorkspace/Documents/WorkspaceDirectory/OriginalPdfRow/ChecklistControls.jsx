import { useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import ChecklistModal from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistModal";
import PdfPageViewer from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/PdfPageViewer";
import ChecklistEditor from "./ChecklistEditor";

export default function ChecklistControls({
  checklist,
  workspaceSlug,
  onUpdated,
}) {
  const [viewing, setViewing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewingPdf, setViewingPdf] = useState(false);
  const [checkedItems, setCheckedItems] = useState({});
  if (!checklist) return null;

  return (
    <>
      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setViewing(true);
          }}
          className="rounded border border-theme-modal-border px-2 py-1 hover:bg-theme-file-picker-hover"
        >
          체크리스트 보기
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setEditing(true);
          }}
          className="rounded border border-theme-modal-border px-2 py-1 hover:bg-theme-file-picker-hover"
        >
          수정
        </button>
        {checklist.source?.pdfRef && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setViewingPdf(true);
            }}
            className="rounded border border-theme-modal-border px-2 py-1 hover:bg-theme-file-picker-hover"
          >
            원본 보기 p.{checklist.source.page}
          </button>
        )}
      </div>
      <ChecklistModal
        checklist={checklist}
        isOpen={viewing}
        onClose={() => setViewing(false)}
        checkedItems={checkedItems}
        onToggleItem={(itemId) =>
          setCheckedItems((current) => ({
            ...current,
            [itemId]: !current[itemId],
          }))
        }
      />
      <ChecklistEditor
        checklist={checklist}
        workspaceSlug={workspaceSlug}
        isOpen={editing}
        onClose={() => setEditing(false)}
        onSaved={onUpdated}
      />
      <Modal
        isOpen={viewingPdf}
        onClose={() => setViewingPdf(false)}
        size="xl"
        className="z-[120]"
      >
        <ModalHeader
          title={`${checklist.source.filename} · p.${checklist.source.page}`}
          onClose={() => setViewingPdf(false)}
        />
        <ModalBody>
          <PdfPageViewer
            workspaceSlug={workspaceSlug}
            pdfRef={checklist.source.pdfRef}
            page={checklist.source.page}
            documentName={checklist.source.filename}
            onUnavailable={() => setViewingPdf(false)}
          />
        </ModalBody>
      </Modal>
    </>
  );
}
