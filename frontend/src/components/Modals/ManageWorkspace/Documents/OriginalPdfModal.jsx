import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import PdfPageViewer from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/PdfPageViewer";

// 등록 문서 이름을 누르면 원본 PDF를 바로 보여줌(기존 근거 보기 화면 재사용).
export default function OriginalPdfModal({ workspaceSlug, doc, onClose }) {
  if (!doc?.pdfRef) return null;
  return (
    <Modal isOpen onClose={onClose} size="xl" className="z-[130]">
      <ModalHeader title={doc.title} onClose={onClose} />
      <ModalBody>
        <PdfPageViewer
          workspaceSlug={workspaceSlug}
          pdfRef={doc.pdfRef}
          page={1}
          documentName={doc.title}
          onUnavailable={onClose}
        />
      </ModalBody>
    </Modal>
  );
}
