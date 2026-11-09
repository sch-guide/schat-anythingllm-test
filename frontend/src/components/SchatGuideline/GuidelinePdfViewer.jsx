import { useEffect, useRef, useState } from "react";
import { openPdfInNewWindow } from "@/utils/openPdfWindow";

const ZOOMS = [1, 1.25, 1.5, 2, 3];

export function clampPage(value, total) {
  const page = Math.trunc(Number(value));
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(page, 1), Math.max(total || 1, 1));
}

/**
 * 지침서 원본 PDF 보기. 보고 있는 쪽만 서버에서 받아 와 그린다(큰 문서도 빨리 열림).
 * 2026-11-09 사용자 요청: PC처럼 "원본 PDF를 새 창에서 열기"를 둔다(누를 때 원본 전체를 받아
 * 보고 있는 쪽부터 연다).
 */
export default function GuidelinePdfViewer({ source, title, jump = null }) {
  const initialPage = jump?.page || 1;
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [status, setStatus] = useState("loading");
  const [page, setPage] = useState(initialPage);
  const [pageInput, setPageInput] = useState(String(initialPage));
  const [zoomIndex, setZoomIndex] = useState(0);
  const [rendering, setRendering] = useState(false);
  const total = pdf?.numPages || 0;
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  async function openNewWindow() {
    if (opening) return;
    setOpening(true);
    setOpenError("");
    const ok = await openPdfInNewWindow(async () => {
      const response = await fetch(source.url, { headers: source.httpHeaders, cache: "no-store" });
      if (!response.ok) throw new Error("원본을 열지 못했습니다.");
      return response.blob();
    }, page);
    setOpening(false);
    if (!ok) setOpenError("새 창을 열지 못했습니다. 브라우저의 팝업 차단을 확인해 주세요.");
  }

  useEffect(() => {
    let active = true;
    let task = null;
    setPdf(null);
    setStatus("loading");
    setPage(initialPage);
    setPageInput(String(initialPage));
    import("@/utils/pdfEvidenceDocument")
      .then(({ openGuidelineDocument }) => {
        task = openGuidelineDocument(source);
        return task.promise;
      })
      .then((doc) => {
        if (!active) return;
        setPdf(doc);
        setStatus("ready");
      })
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
      task?.destroy();
    };
    // 같은 문서 안에서 검색 결과로 쪽만 바꿀 때는 다시 받지 않는다(아래 효과).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.url]);

  // 검색 결과를 누르면 그 쪽으로 이동한다(같은 쪽을 다시 눌러도 이동).
  useEffect(() => {
    if (!jump?.page) return;
    const next = clampPage(jump.page, pdf?.numPages || jump.page);
    setPage(next);
    setPageInput(String(next));
  }, [jump?.page, jump?.at, pdf]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !frameRef.current) return;
    let cancelled = false;
    let renderTask = null;
    setRendering(true);
    pdf
      .getPage(clampPage(page, pdf.numPages))
      .then((pdfPage) => {
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const width = Math.max(frameRef.current.clientWidth - 16, 240);
        const scale = (width / base.width) * ZOOMS[zoomIndex];
        const ratio = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: scale * ratio });
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
        renderTask = pdfPage.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
        });
        return renderTask.promise;
      })
      .catch(() => null)
      .finally(() => !cancelled && setRendering(false));
    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [pdf, page, zoomIndex]);

  function go(target) {
    const next = clampPage(target, total);
    setPage(next);
    setPageInput(String(next));
    frameRef.current?.scrollTo?.({ top: 0 });
  }

  const button =
    "rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-100 hover:border-sky-500 disabled:opacity-40 light:border-slate-300 light:text-slate-700";

  if (status === "error")
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
        지침서를 열지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    );

  return (
    <section aria-label={`${title} 원본`} className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={!total || page <= 1} onClick={() => go(page - 1)}>
          이전 쪽
        </button>
        <form
          className="flex items-center gap-1 text-sm text-zinc-300 light:text-slate-600"
          onSubmit={(event) => {
            event.preventDefault();
            go(pageInput);
          }}
        >
          <input
            aria-label="이동할 쪽"
            inputMode="numeric"
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value.replace(/[^0-9]/g, ""))}
            className="w-16 rounded-lg border border-zinc-600 bg-transparent px-2 py-1.5 text-center text-white light:border-slate-300 light:text-slate-900"
          />
          <span>/ {total || "…"}쪽</span>
          <button type="submit" className={button} disabled={!total}>
            이동
          </button>
        </form>
        <button type="button" className={button} disabled={!total || page >= total} onClick={() => go(page + 1)}>
          다음 쪽
        </button>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="축소" className={button} disabled={zoomIndex === 0} onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}>
            −
          </button>
          <button type="button" aria-label="확대" className={button} disabled={zoomIndex === ZOOMS.length - 1} onClick={() => setZoomIndex((i) => Math.min(ZOOMS.length - 1, i + 1))}>
            +
          </button>
        </span>
      </div>
      <div
        ref={frameRef}
        className="relative min-h-[60vh] overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-2 light:border-slate-300 light:bg-slate-100"
      >
        {(status === "loading" || rendering) && (
          <p role="status" className="absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-xs text-white">
            {status === "loading" ? "지침서를 여는 중입니다." : "쪽을 불러오는 중입니다."}
          </p>
        )}
        <canvas ref={canvasRef} aria-label={`${title} ${page}쪽`} className="mx-auto block bg-white" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={openNewWindow}
          disabled={opening}
          data-testid="guideline-mobile-open-new-window"
          className="text-sm font-medium text-blue-300 disabled:opacity-60 light:text-blue-700"
        >
          {opening ? "원본 PDF를 여는 중입니다. 큰 문서는 몇 초 걸릴 수 있습니다." : "원본 PDF를 새 창에서 열기"}
        </button>
        {openError && (
          <p role="alert" className="text-xs text-red-400 light:text-red-600">
            {openError}
          </p>
        )}
      </div>
    </section>
  );
}
