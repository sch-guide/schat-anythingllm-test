import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import RelatedImages from "../RelatedImages";

// pdf.js is only downloaded when a phone opens an original PDF.
const PdfPageCanvas = lazy(() => import("./PdfPageCanvas"));

export const MOBILE_SOURCE_QUERY = "(max-width: 767px)";
const HISTORY_FLAG = "schatSourceView";

export function useMobileViewport() {
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.(MOBILE_SOURCE_QUERY).matches
  );
  useEffect(() => {
    const query = window.matchMedia?.(MOBILE_SOURCE_QUERY);
    if (!query) return;
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isMobile;
}

/**
 * Mobile-only full-screen source view: "← 채팅으로", the source name/page and
 * [PDF 원문] [텍스트 원문] tabs that stay visible so the reader can switch
 * back and forth. The chat stays mounted underneath, so its scroll position
 * is kept. Opening pushes one history entry (the router's own state is
 * preserved) so the phone's back button closes this view instead of leaving
 * the chat.
 */
export default function MobileSourceScreen({
  source,
  summary,
  paragraphs,
  documentName,
  workspaceSlug,
  onClose,
}) {
  const hasPdf = Boolean(source?.pdfRef && workspaceSlug);
  const [tab, setTab] = useState(hasPdf ? "pdf" : "text");
  const [pdfFailed, setPdfFailed] = useState(!hasPdf);
  const closedByHistory = useRef(false);
  const titleRef = useRef(null);

  useEffect(() => {
    window.history.pushState(
      { ...(window.history.state || {}), [HISTORY_FLAG]: true },
      ""
    );
    const onPop = () => {
      closedByHistory.current = true;
      onClose();
    };
    window.addEventListener("popstate", onPop);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    titleRef.current?.focus();
    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = previousOverflow;
      // Closed some other way (e.g. the chat re-rendered): unmark our entry
      // instead of navigating, so nothing else reacts to it.
      if (!closedByHistory.current && window.history.state?.[HISTORY_FLAG]) {
        const { [HISTORY_FLAG]: _flag, ...state } = window.history.state;
        window.history.replaceState(state, "");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goBack = () => {
    if (window.history.state?.[HISTORY_FLAG]) window.history.back();
    else onClose();
  };
  const markPdfFailed = useCallback(() => {
    setPdfFailed(true);
    setTab("text");
  }, []);

  const tabClass = (active) =>
    `flex-1 rounded-md py-2 text-sm font-medium transition-colors disabled:opacity-40 ${
      active
        ? "bg-sky-600 !text-white"
        : "text-zinc-300 light:text-slate-600 hover:bg-zinc-800 light:hover:bg-slate-200"
    }`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="근거 원문"
      data-testid="mobile-source-screen"
      className="fixed inset-0 z-[200] flex flex-col bg-zinc-900 light:bg-white"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <header className="flex flex-col gap-2 border-b border-zinc-800 px-3 pb-2 pt-2 light:border-slate-200">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            className="-ml-1 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-blue-300 light:text-blue-700"
          >
            <ArrowLeft size={18} weight="bold" aria-hidden="true" />
            채팅으로
          </button>
        </div>
        <p
          ref={titleRef}
          tabIndex={-1}
          className="break-words px-1 text-sm font-semibold text-zinc-100 outline-none light:text-slate-900"
        >
          {summary || documentName || "근거 원문"}
        </p>
        <div
          role="tablist"
          aria-label="원문 보기 방식"
          className="flex gap-1 rounded-lg bg-zinc-800/70 p-1 light:bg-slate-100"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pdf"}
            disabled={pdfFailed}
            onClick={() => setTab("pdf")}
            className={tabClass(tab === "pdf")}
          >
            PDF 원문
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "text"}
            onClick={() => setTab("text")}
            className={tabClass(tab === "text")}
          >
            텍스트 원문
          </button>
        </div>
      </header>

      {/* Both panels stay mounted so switching tabs keeps the rendered page. */}
      <div
        className={`${tab !== "pdf" || pdfFailed ? "hidden" : "flex"} min-h-0 flex-1 flex-col`}
      >
        {hasPdf && !pdfFailed && (
          <Suspense
            fallback={
              <p className="p-6 text-center text-sm text-zinc-400">
                원본 PDF를 준비하는 중입니다.
              </p>
            }
          >
            <PdfPageCanvas
              workspaceSlug={workspaceSlug}
              pdfRef={source.pdfRef}
              page={source.page}
              documentName={documentName}
              onUnavailable={markPdfFailed}
            />
          </Suspense>
        )}
      </div>
      <div
        className={`${tab === "text" ? "block" : "hidden"} min-h-0 flex-1 overflow-y-auto px-4 py-4`}
        data-testid="mobile-source-text"
      >
        {pdfFailed && hasPdf && (
          <p className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200 light:text-amber-800">
            원본 PDF를 불러올 수 없어 텍스트 근거를 표시합니다.
          </p>
        )}
        <div className="space-y-3 break-words text-[15px] leading-[1.75] text-zinc-100 light:text-slate-900">
          {paragraphs.length > 0 ? (
            paragraphs.map((paragraph, index) => (
              <p key={index} className="whitespace-pre-line">
                {paragraph}
              </p>
            ))
          ) : (
            <p className="text-zinc-400 light:text-slate-500">
              표시할 텍스트 근거가 없습니다.
            </p>
          )}
        </div>
        <RelatedImages
          images={source.relatedImages || []}
          workspaceSlug={workspaceSlug}
        />
      </div>
    </div>,
    document.body
  );
}
