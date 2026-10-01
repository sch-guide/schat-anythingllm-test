import { useEffect, useRef, useState } from "react";
import {
  GlobalWorkerOptions,
  getDocument,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import StorageFiles from "@/models/files";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const ZOOMS = [1, 1.5, 2, 3];

function normalizedPage(page) {
  const value = Number(page);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

/**
 * Mobile original-PDF view. Mobile browsers either cannot show a PDF inside an
 * iframe or ignore "#page=", so the cited page is drawn onto a canvas that
 * fills the screen width. The PDF still comes from the authenticated
 * original-PDF endpoint (pdfRef); nothing else is fetched.
 */
export default function PdfPageCanvas({
  workspaceSlug,
  pdfRef,
  page,
  documentName,
  onUnavailable,
}) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [rendered, setRendered] = useState(false);
  const pageNumber = normalizedPage(page);

  useEffect(() => {
    let active = true;
    let loadingTask = null;
    setPdf(null);
    StorageFiles.originalPdf(workspaceSlug, pdfRef)
      .then(async (blob) => {
        if (!active) return;
        if (!blob || blob.type !== "application/pdf") return onUnavailable?.();
        loadingTask = getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
          isEvalSupported: false,
        });
        const doc = await loadingTask.promise;
        if (!active) return doc.destroy();
        if (pageNumber > doc.numPages) {
          doc.destroy();
          return onUnavailable?.();
        }
        setPdf(doc);
      })
      .catch(() => active && onUnavailable?.());
    return () => {
      active = false;
      loadingTask?.destroy();
    };
  }, [workspaceSlug, pdfRef, pageNumber, onUnavailable]);

  useEffect(() => () => pdf?.destroy(), [pdf]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !frameRef.current) return;
    let renderTask = null;
    let cancelled = false;
    setRendered(false);
    pdf
      .getPage(pageNumber)
      .then((pdfPage) => {
        if (cancelled) return;
        const width = frameRef.current.clientWidth || window.innerWidth;
        const base = pdfPage.getViewport({ scale: 1 });
        const cssScale = (width / base.width) * zoom;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
        const viewport = pdfPage.getViewport({ scale: cssScale * pixelRatio });
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(base.width * cssScale)}px`;
        canvas.style.height = `${Math.floor(base.height * cssScale)}px`;
        renderTask = pdfPage.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
        });
        return renderTask.promise.then(() => !cancelled && setRendered(true));
      })
      .catch((error) => {
        if (!cancelled && error?.name !== "RenderingCancelledException")
          onUnavailable?.();
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, zoom, onUnavailable]);

  const zoomIndex = ZOOMS.indexOf(zoom);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={frameRef}
        className="relative min-h-0 flex-1 overflow-auto bg-zinc-800 light:bg-slate-200"
        data-testid="mobile-pdf-frame"
      >
        {!rendered && (
          <p className="absolute inset-x-0 top-8 text-center text-sm text-zinc-300 light:text-slate-600">
            원본 PDF 페이지를 불러오는 중입니다.
          </p>
        )}
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={documentName || "원본 PDF"}
          className="block bg-white"
        />
      </div>
      <div className="flex items-center justify-center gap-3 border-t border-zinc-800 py-2 light:border-slate-200">
        <button
          type="button"
          aria-label="축소"
          disabled={zoomIndex <= 0}
          onClick={() => setZoom(ZOOMS[zoomIndex - 1])}
          className="h-9 w-9 rounded-full border border-zinc-600 text-lg text-zinc-100 disabled:opacity-40 light:border-slate-300 light:text-slate-800"
        >
          −
        </button>
        <span className="w-12 text-center text-xs text-zinc-300 light:text-slate-600">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="확대"
          disabled={zoomIndex >= ZOOMS.length - 1}
          onClick={() => setZoom(ZOOMS[zoomIndex + 1])}
          className="h-9 w-9 rounded-full border border-zinc-600 text-lg text-zinc-100 disabled:opacity-40 light:border-slate-300 light:text-slate-800"
        >
          +
        </button>
      </div>
    </div>
  );
}
