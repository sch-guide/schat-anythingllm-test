import { useEffect, useMemo, useRef, useState } from "react";
import StorageFiles from "@/models/files";
import {
  inspectPdfEvidence,
  documentEvidenceTexts,
  saveHighlightedPdf,
  pdfHighlightUrl,
} from "@/utils/pdfEvidenceHighlight";

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
  evidenceTexts = [],
  documentName,
  onUnavailable,
  onShowText,
}) {
  const frameRef = useRef(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const [objectUrl, setObjectUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [position, setPosition] = useState(null);
  const [originalUrl, setOriginalUrl] = useState("");
  const [displayPage, setDisplayPage] = useState(normalizedPdfPage(page));
  const evidenceKey = JSON.stringify(
    documentEvidenceTexts(documentName, evidenceTexts)
  );
  const widthZoom =
    frameWidth && pageWidth
      ? Math.max(
          1,
          Math.floor(((frameWidth - 24) / ((pageWidth * 96) / 72)) * 100)
        )
      : undefined;
  const viewerUrl = useMemo(
    () => pdfHighlightUrl(objectUrl, displayPage, position, widthZoom),
    [objectUrl, displayPage, position, widthZoom]
  );

  useEffect(() => {
    if (!objectUrl || !frameRef.current) return;
    const frame = frameRef.current;
    const observer = new ResizeObserver(() => setFrameWidth(frame.clientWidth));
    observer.observe(frame);
    setFrameWidth(frame.clientWidth);
    return () => observer.disconnect();
  }, [objectUrl]);

  useEffect(() => {
    let active = true;
    const urls = [];
    let task = null;
    setObjectUrl("");
    setLoaded(false);
    setPosition(null);
    setPageWidth(0);
    setOriginalUrl("");
    setDisplayPage(normalizedPdfPage(page));

    StorageFiles.originalPdf(workspaceSlug, pdfRef)
      .then(async (blob) => {
        if (!active) return;
        if (!blob || blob.type !== "application/pdf") {
          onUnavailable?.();
          return;
        }
        const original = URL.createObjectURL(blob);
        urls.push(original);
        setOriginalUrl(original);
        let displayed = original;
        try {
          const { openEvidenceDocument } = await import(
            "@/utils/pdfEvidenceDocument"
          );
          if (!active) return;
          const data = new Uint8Array(await blob.arrayBuffer());
          if (!active) return;
          task = openEvidenceDocument(data);
          const pdf = await task.promise;
          if (!active) return;
          const result = await inspectPdfEvidence(
            pdf,
            page,
            JSON.parse(evidenceKey)
          );
          if (!active) return;
          setDisplayPage(result.page);
          const destinationPage = await pdf.getPage(result.page);
          if (!active) return;
          setPageWidth(destinationPage.getViewport({ scale: 1 }).width);
          if (result.matched) {
            const saved = await saveHighlightedPdf(
              pdf,
              result.page,
              result.paintRects
            );
            if (!active) return;
            displayed = URL.createObjectURL(
              new Blob([saved], { type: "application/pdf" })
            );
            urls.push(displayed);
            const pdfPage = await pdf.getPage(result.page);
            if (!active) return;
            const viewport = pdfPage.getViewport({ scale: 1 });
            const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(
              result.rects[0]
            );
            setPosition([Math.min(x1, x2), Math.min(y1, y2)]);
          }
        } catch {
          displayed = original;
          if (active) {
            setPosition(null);
          }
        } finally {
          await task?.destroy();
        }
        if (active) setObjectUrl(displayed);
      })
      .catch(() => active && onUnavailable?.());

    return () => {
      active = false;
      task?.destroy();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [workspaceSlug, pdfRef, page, evidenceKey, onUnavailable]);

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
        ref={frameRef}
        title={documentName || "원본 PDF"}
        aria-label="PDF 원본"
        src={viewerUrl}
        className="h-[70vh] min-h-[420px] w-full rounded-lg border border-zinc-700 bg-white light:border-slate-300 max-sm:h-[62vh] max-sm:min-h-[320px]"
        onLoad={() => setLoaded(true)}
        onError={() => onUnavailable?.()}
      />
      <div className="mt-2 flex justify-center">
        <a
          href={pdfViewerUrl(originalUrl, displayPage)}
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
