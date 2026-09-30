import { useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import PdfPageViewer from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/PdfPageViewer";
import ChecklistEditor from "./ChecklistEditor";

// "체크리스트 보기" and "수정" open the same screen (ChecklistEditor) in view
// or edit mode, so the administrator sees one layout for both.
export default function ChecklistControls({
  checklist,
  workspaceSlug,
  onUpdated,
}) {
  const [openMode, setOpenMode] = useState(null);
  const [viewingPdf, setViewingPdf] = useState(false);
  if (!checklist) return null;

  return (
    <>
      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpenMode("view");
          }}
          className="rounded border border-theme-modal-border px-2 py-1 hover:bg-theme-file-picker-hover"
        >
          체크리스트 보기
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpenMode("edit");
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
      <ChecklistEditor
        checklist={checklist}
        workspaceSlug={workspaceSlug}
        isOpen={openMode !== null}
        initialMode={openMode || "view"}
        onClose={() => setOpenMode(null)}
        onSaved={onUpdated}
        onOpenSource={() => setViewingPdf(true)}
      />
      {checklist.source?.pdfRef && (
        <Modal
          isOpen={viewingPdf}
          onClose={() => setViewingPdf(false)}
          size="xl"
          className="z-[130]"
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
      )}
    </>
  );
}
