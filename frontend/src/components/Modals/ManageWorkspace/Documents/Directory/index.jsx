import UploadFile from "../UploadFile";
import PreLoader from "@/components/Preloader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilePdf, MagnifyingGlass } from "@phosphor-icons/react";
import Workspace from "@/models/workspace";
import useUploadQueue from "../hooks/useUploadQueue";
import OriginalPdfModal from "../OriginalPdfModal";
import {
  filesToStage,
  filterLibrary,
  libraryStatus,
  uploadedKeys,
} from "./documentLibraryView";

const STATUS_TONE = {
  registered: "text-green-400 light:text-green-700",
  partial: "text-amber-400 light:text-amber-700",
  staged: "text-sky-400 light:text-sky-700",
  processing: "text-sky-400 light:text-sky-700",
  older: "text-theme-text-secondary",
  unregistered: "text-theme-text-secondary",
};

const dateText = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString("ko-KR")
    : "";
};

/**
 * SCHAT 문서 등록 창의 왼쪽. 쪽 단위 파일 대신 문서 한 줄씩 보여줌.
 * - 등록된 문서도 함께 보이고, 이름을 누르면 원본 PDF를 봄.
 * - 등록 전 문서를 골라 오른쪽 등록 목록에 올림(저장은 오른쪽에서).
 * - 문서 이름 검색은 화면 안에서 바로 걸러냄(더 보기 없음).
 */
export default function Directory({
  workspace,
  reloadKey = 0,
  stagedPaths,
  processingPaths,
  onStage,
  onUpdateComplete,
  setHighlightWorkspace,
}) {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [viewing, setViewing] = useState(null);
  const justUploaded = useRef([]);
  const uploadQueue = useUploadQueue(workspace);

  const load = useCallback(async () => {
    const result = await Workspace.documentLibrary(workspace.slug);
    if (!result) {
      setFailed(true);
      setDocuments((prev) => prev || []);
      return { success: false };
    }
    setFailed(false);
    setDocuments(result);
    if (justUploaded.current.length) {
      const keys = uploadedKeys(result, justUploaded.current);
      justUploaded.current = [];
      if (keys.length) setSelected((prev) => new Set([...prev, ...keys]));
    }
    return { success: true };
  }, [workspace.slug]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  // 업로드가 끝나면 목록을 새로 읽고 방금 올린 문서를 골라 둠.
  const handleUploaded = useCallback(
    (docpaths = []) => {
      justUploaded.current = [...justUploaded.current, ...docpaths];
      return load();
    },
    [load]
  );
  const handleUpdated = useCallback(async () => {
    await load();
    await onUpdateComplete?.();
  }, [load, onUpdateComplete]);

  const staged = stagedPaths || new Set();
  const processing = processingPaths || new Set();
  const visible = useMemo(
    () => filterLibrary(documents || [], query),
    [documents, query]
  );
  const selectable = (doc) => libraryStatus(doc, staged, processing).selectable;
  const selectedDocs = (documents || []).filter(
    (doc) => selected.has(doc.key) && selectable(doc)
  );

  function toggle(doc) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(doc.key) ? next.delete(doc.key) : next.add(doc.key);
      return next;
    });
  }

  function stage() {
    const files = filesToStage(
      documents || [],
      new Set(selectedDocs.map((doc) => doc.key)),
      staged
    );
    if (files.length) onStage(files);
    setSelected(new Set());
    setHighlightWorkspace?.(false);
  }

  return (
    <div className="px-8 pb-8">
      <div className="flex flex-col gap-y-6">
        <div className="flex items-center justify-between w-[560px] px-5 relative">
          <h3 className="text-white text-base font-bold">
            {t("connectors.directory.my-documents")}
          </h3>
          <div className="relative">
            <input
              type="search"
              aria-label="문서 이름 검색"
              placeholder={t("connectors.directory.search-document")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="border-none search-input bg-theme-settings-input-bg text-white placeholder:text-theme-settings-input-placeholder focus:outline-primary-button active:outline-primary-button outline-none text-sm rounded-lg pl-9 pr-2.5 py-2 w-[250px] h-[32px] light:border-theme-modal-border light:border"
            />
            <MagnifyingGlass
              size={14}
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white"
              weight="bold"
            />
          </div>
        </div>

        <div
          className="relative w-[560px] h-[310px] bg-theme-settings-input-bg rounded-2xl overflow-hidden border border-theme-modal-border"
          data-testid="document-library"
        >
          <div className="absolute top-0 left-0 right-0 z-10 rounded-t-2xl text-theme-text-primary text-xs grid grid-cols-12 py-2 px-6 border-b border-white/20 light:border-theme-modal-border bg-theme-settings-input-bg">
            <p className="col-span-8">문서 이름</p>
            <p className="col-span-4 text-right text-theme-text-secondary">
              {documents
                ? query
                  ? `검색 결과 ${visible.length}개`
                  : `문서 ${documents.length}개`
                : ""}
            </p>
          </div>

          <div className="overflow-y-auto h-full pt-8 pb-14">
            {!documents ? (
              <div className="w-full h-full flex items-center justify-center">
                <PreLoader />
              </div>
            ) : visible.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center px-6 text-center">
                <p className="text-theme-text-secondary text-sm">
                  {failed
                    ? "문서 목록을 불러오지 못했어요. 창을 닫았다가 다시 열어 주세요."
                    : query
                      ? "이름이 맞는 문서가 없어요."
                      : "아직 올린 문서가 없어요. 아래에서 PDF를 올려 주세요."}
                </p>
              </div>
            ) : (
              visible.map((doc) => {
                const status = libraryStatus(doc, staged, processing);
                const canView =
                  !!doc.pdfRef &&
                  doc.originalPdfAvailable !== false &&
                  ["registered", "partial"].includes(doc.status);
                return (
                  <div
                    key={doc.key}
                    data-testid="document-library-row"
                    className={`grid grid-cols-12 items-center gap-x-2 px-4 py-2 text-xs text-theme-text-primary border-b border-white/5 light:border-theme-modal-border ${
                      selected.has(doc.key) && status.selectable
                        ? "bg-sky-500/20"
                        : ""
                    }`}
                  >
                    <div className="col-span-9 flex min-w-0 items-center gap-x-2">
                      <input
                        type="checkbox"
                        aria-label={`${doc.title} 선택`}
                        className="h-3.5 w-3.5 shrink-0 accent-sky-600 disabled:opacity-30"
                        disabled={!status.selectable}
                        checked={status.selectable && selected.has(doc.key)}
                        onChange={() => toggle(doc)}
                      />
                      <FilePdf
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0"
                        weight="fill"
                      />
                      <div className="min-w-0">
                        {canView ? (
                          <button
                            type="button"
                            className="block max-w-full truncate text-left font-medium underline-offset-2 hover:underline"
                            title="원본 PDF 보기"
                            onClick={() => setViewing(doc)}
                          >
                            {doc.title}
                          </button>
                        ) : (
                          <p className="truncate font-medium" title={doc.title}>
                            {doc.title}
                          </p>
                        )}
                        <p className="text-[10px] text-theme-text-secondary">
                          {doc.pages}쪽
                          {dateText(doc.uploadedAt)
                            ? ` · ${dateText(doc.uploadedAt)}`
                            : ""}
                          {canView ? " · 이름을 누르면 원문 보기" : ""}
                        </p>
                      </div>
                    </div>
                    <p
                      className={`col-span-3 text-right font-medium ${STATUS_TONE[status.key]}`}
                    >
                      {status.label}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          {selectedDocs.length > 0 && (
            <div className="absolute bottom-[12px] left-0 right-0 flex justify-center">
              <button
                type="button"
                onClick={stage}
                onMouseEnter={() => setHighlightWorkspace?.(true)}
                onMouseLeave={() => setHighlightWorkspace?.(false)}
                className="border-none text-sm font-semibold bg-white light:bg-[#E0F2FE] h-[32px] px-3 rounded-lg shadow-lg hover:bg-neutral-800/80 hover:text-white light:text-[#026AA2] light:hover:bg-[#026AA2] light:hover:text-white"
              >
                선택한 문서 {selectedDocs.length}개 등록 목록에 추가
              </button>
            </div>
          )}
        </div>
        <UploadFile
          workspace={workspace}
          queue={uploadQueue}
          onUploadComplete={handleUploaded}
          onLinkScraped={handleUploaded}
          onUpdateComplete={handleUpdated}
        />
      </div>
      {viewing && (
        <OriginalPdfModal
          workspaceSlug={workspace.slug}
          doc={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
