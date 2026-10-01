import { useEffect, useMemo, useState } from "react";
import StorageFiles from "@/models/files";

function normalizedPdfPage(page) {
  const value = Number(page);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function pdfViewerUrl(objectUrl, page) {
  if (!objectUrl) return "";
  return `${objectUrl}#page=${normalizedPdfPage(page)}&view=FitH`;
}

export default function PdfPageViewer({
  workspaceSlug,
  pdfRef,
  page,
  documentName,
  onUnavailable,
  onShowText,
}) {
  const [objectUrl, setObjectUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const viewerUrl = useMemo(
    () => pdfViewerUrl(objectUrl, page),
    [objectUrl, page]
  );

  useEffect(() => {
    let active = true;
    let currentUrl = "";
    setObjectUrl("");
    setLoaded(false);

    StorageFiles.originalPdf(workspaceSlug, pdfRef).then((blob) => {
      if (!active) return;
      if (!blob || blob.type !== "application/pdf") {
        onUnavailable?.();
        return;
      }
      currentUrl = URL.createObjectURL(blob);
      setObjectUrl(currentUrl);
    });

    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [workspaceSlug, pdfRef, onUnavailable]);

  if (!viewerUrl) {
    return (
      <div
        aria-label="PDF 원본"
        className="flex min-h-[260px] w-full items-center justify-center rounded-lg bg-zinc-950 text-sm text-zinc-400 light:bg-slate-200 light:text-slate-600 sm:min-h-[420px]"
      >
        원본 PDF 페이지를 불러오는 중입니다.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[920px]">
      {!loaded && (
        <p className="mb-2 text-center text-xs text-zinc-400 light:text-slate-500">
          PDF viewer를 준비하는 중입니다.
        </p>
      )}
      <iframe
        title={documentName || "원본 PDF"}
        aria-label="PDF 원본"
        src={viewerUrl}
        className="h-[70vh] min-h-[420px] w-full rounded-lg border border-zinc-700 bg-white light:border-slate-300 max-sm:h-[62vh] max-sm:min-h-[320px]"
        onLoad={() => setLoaded(true)}
        onError={() => onUnavailable?.()}
      />
      <div className="mt-2 flex justify-center">
        <a
          href={viewerUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-blue-300 hover:text-blue-200 light:text-blue-700 light:hover:text-blue-800"
        >
          원본 PDF를 새 창에서 열기
        </a>
        <span className="mx-2 text-zinc-600 light:text-slate-400">|</span>
        <button
          type="button"
          // Only switches the view; the PDF can be shown again afterwards.
          onClick={() => (onShowText ? onShowText() : onUnavailable?.())}
          className="text-xs font-medium text-zinc-300 hover:text-white light:text-slate-600 light:hover:text-slate-900"
        >
          텍스트 원문으로 보기
        </button>
      </div>
    </div>
  );
}
