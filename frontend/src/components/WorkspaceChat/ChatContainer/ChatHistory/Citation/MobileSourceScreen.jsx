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
import { sourceHighlightTexts } from "@/utils/pdfEvidenceHighlight";
import EvidenceText from "../../SourcesSidebar/EvidenceText";
import SpreadsheetViewer from "./SpreadsheetViewer";
import StorageFiles from "@/models/files";
import { openPdfInNewWindow } from "@/utils/openPdfWindow";

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
 * the original PDF page with "원본 PDF를 새 창에서 열기" (2026-11-09: same as
 * the PC view; the [PDF 원문][텍스트 원문] tabs were removed). The text
 * evidence is shown only when there is no PDF or it cannot be opened. The chat stays mounted underneath, so its scroll position
 * is kept. Opening pushes one history entry (the router's own state is
 * preserved) so the phone's back button closes this view instead of leaving
 * the chat.
 */
export default function MobileSourceScreen({
  source,
  answerText = "",
  summary,
  paragraphs,
  documentName,
  workspaceSlug,
  onClose,
}) {
  const isExcel = /\.(xlsx|xls)$/iu.test(documentName || "");
  const hasPdf = Boolean(source?.pdfRef && workspaceSlug);
  const [pdfFailed, setPdfFailed] = useState(!hasPdf);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const tab = pdfFailed ? "text" : "pdf";
  const [pdfDeleted, setPdfDeleted] = useState(false);
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
  const markPdfFailed = useCallback((reason) => {
    setPdfFailed(true);
    setPdfDeleted(reason === 'deleted');
  }, []);
  const openNewWindow = async () => {
    if (opening) return;
    setOpening(true);
    setOpenError("");
    const ok = await openPdfInNewWindow(
      () => StorageFiles.originalPdf(workspaceSlug, source.pdfRef),
      source.page
    );
    setOpening(false);
    if (!ok) setOpenError("새 창을 열지 못했습니다. 브라우저의 팝업 차단을 확인해 주세요.");
  };

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
        {!source?.pdfRef && !isExcel && (
          <p role="status" className="text-xs text-zinc-400 light:text-slate-500">
            아래는 문서에서 읽은 근거 텍스트입니다. 연두색은 답변에 사용된 부분입니다.
          </p>
        )}
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
        {!isExcel && hasPdf && !pdfFailed && (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={openNewWindow}
              disabled={opening}
              data-testid="mobile-open-new-window"
              className="text-sm font-medium text-blue-300 disabled:opacity-60 light:text-blue-700"
            >
              {opening ? "원본 PDF를 여는 중입니다." : "원본 PDF를 새 창에서 열기"}
            </button>
            {openError && (
              <p role="alert" className="text-xs text-red-400 light:text-red-600">
                {openError}
              </p>
            )}
          </div>
        )}
      </header>

      {/* PDF를 열 수 있으면 PDF만, 열 수 없으면 글자 원문만 보인다. */}
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
              evidenceTexts={sourceHighlightTexts(source)}
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
            {pdfDeleted ? '이 출처는 이전 버전 문서로 현재 원문을 확인할 수 없습니다.' : '원본 PDF를 불러올 수 없어 텍스트 근거를 표시합니다.'}
          </p>
        )}
        <div className="space-y-3 break-words text-[15px] leading-[1.75] text-zinc-100 light:text-slate-900">
          {isExcel && <SpreadsheetViewer source={source} workspaceSlug={workspaceSlug} answerText={answerText} />}
          {!isExcel && (paragraphs.length > 0 ? (
            <EvidenceText text={paragraphs.join("\n\n")} quotes={source.highlightTexts || []} />
          ) : (
            <p className="text-zinc-400 light:text-slate-500">
              표시할 텍스트 근거가 없습니다.
            </p>
          ))}
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
