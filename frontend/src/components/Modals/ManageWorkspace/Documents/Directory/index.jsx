import UploadFile from "../UploadFile";
import PreLoader from "@/components/Preloader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilePdf, MagnifyingGlass } from "@phosphor-icons/react";
import Workspace from "@/models/workspace";
import SchatAdmin from "@/models/schatAdmin";
import useUser from "@/hooks/useUser";
import showToast from "@/utils/toast";
import useUploadQueue from "../hooks/useUploadQueue";
import OriginalPdfModal from "../OriginalPdfModal";
import {
  checklistCount,
  deleteState,
  filesToStage,
  filterLibrary,
  librarySections,
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
const CURRENT_LABEL = { registered: "현재 사용 중", partial: "일부 등록" };

const dateText = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString("ko-KR")
    : "";
};

/**
 * SCHAT 문서 등록 창의 왼쪽. 쪽 단위 파일 대신 문서 한 줄씩 보여줌.
 * - 현재 사용 중 문서: 원본 보기만(삭제 없음).
 * - 예전 문서·등록 전 문서: 등록 목록에 추가하거나, 서버 안전 점검을 통과하면 삭제.
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
  const { user } = useUser();
  const isAdmin = !user || user.role === "admin";
  const [documents, setDocuments] = useState(null);
  const [groups, setGroups] = useState(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const justUploaded = useRef([]);
  const uploadQueue = useUploadQueue(workspace);

  // 삭제 가능 여부는 서버 안전 점검 결과로만 정함(관리자만 조회 가능).
  const loadSafety = useCallback(
    async (refresh = false) => {
      if (!isAdmin) return;
      const report = await SchatAdmin.storageReport({ refresh });
      setGroups(
        report?.groups
          ? new Map(report.groups.map((group) => [group.key, group]))
          : new Map()
      );
    },
    [isAdmin]
  );

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
    loadSafety();
  }, [load, loadSafety, reloadKey]);

  // 업로드가 끝나면 목록을 새로 읽고 방금 올린 문서를 골라 둠.
  const handleUploaded = useCallback(
    (docpaths = []) => {
      justUploaded.current = [...justUploaded.current, ...docpaths];
      loadSafety();
      return load();
    },
    [load, loadSafety]
  );
  const handleUpdated = useCallback(async () => {
    await load();
    loadSafety();
    await onUpdateComplete?.();
  }, [load, loadSafety, onUpdateComplete]);

  const staged = stagedPaths || new Set();
  const processing = processingPaths || new Set();
  const visible = useMemo(
    () => filterLibrary(documents || [], query),
    [documents, query]
  );
  const sections = librarySections(visible);
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

  async function handleDeleted() {
    setDeleting(null);
    setSelected(new Set());
    await load();
    await loadSafety();
  }

  function renderRow(doc) {
    const status = libraryStatus(doc, staged, processing);
    const removal = deleteState(doc, groups, isAdmin);
    const checklists = checklistCount(doc, groups);
    const canView = !!doc.pdfRef && doc.originalPdfAvailable === true;
    const current = ["registered", "partial"].includes(doc.status);
    return (
      <div
        key={doc.key}
        data-testid="document-library-row"
        className={`grid grid-cols-12 items-center gap-x-2 px-4 py-2 text-xs text-theme-text-primary border-b border-white/5 light:border-theme-modal-border ${
          selected.has(doc.key) && status.selectable ? "bg-sky-500/20" : ""
        }`}
      >
        <div className="col-span-7 flex min-w-0 items-center gap-x-2">
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
            <p className="truncate font-medium" title={doc.title}>
              {doc.title}
            </p>
            <p className="text-[10px] text-theme-text-secondary">
              {doc.pages}쪽{checklists ? ` · 체크리스트 ${checklists}개` : ""}
              {!current && dateText(doc.uploadedAt)
                ? ` · ${dateText(doc.uploadedAt)}`
                : ""}
            </p>
            {!current && removal.reason && (
              <p className="text-[10px] text-theme-text-secondary">
                {removal.reason}
              </p>
            )}
          </div>
        </div>
        <div className="col-span-5 flex flex-wrap items-center justify-end gap-1.5">
          <span
            className={`font-medium ${STATUS_TONE[status.key]}`}
            title={current ? "현재 사용 중인 문서입니다." : undefined}
          >
            {current ? CURRENT_LABEL[doc.status] : status.label}
          </span>
          {canView && (
            <button
              type="button"
              onClick={() => setViewing(doc)}
              className="rounded border border-theme-modal-border px-1.5 py-0.5 text-[10px] font-medium hover:bg-theme-file-picker-hover"
            >
              원본 보기
            </button>
          )}
          {removal.deletable && (
            <button
              type="button"
              onClick={() => setDeleting(doc)}
              className="rounded border border-red-400 px-1.5 py-0.5 text-[10px] font-medium text-red-500 hover:bg-red-500/10"
            >
              삭제
            </button>
          )}
        </div>
      </div>
    );
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
              <>
                {sections.current.length > 0 && (
                  <section data-testid="library-current">
                    <p className="px-4 pt-2 pb-1 text-[11px] font-semibold text-theme-text-secondary">
                      현재 사용 중
                    </p>
                    {sections.current.map(renderRow)}
                  </section>
                )}
                {sections.old.length > 0 && (
                  <section data-testid="library-old">
                    <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-theme-text-secondary">
                      예전 문서 · 등록 전 문서
                      <span className="ml-1 font-normal">
                        (지금 검색에 쓰지 않음)
                      </span>
                    </p>
                    {sections.old.map(renderRow)}
                  </section>
                )}
              </>
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
      {deleting && (
        <DeleteOldDocumentDialog
          doc={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}

/**
 * 예전 문서 삭제 확인창. [삭제]를 누르면 서버가 다시 점검(미리보기)한 뒤
 * 삭제하고, 삭제 직후 현재 자료가 그대로인지 한 번 더 확인함.
 */
export function DeleteOldDocumentDialog({ doc, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function remove() {
    setBusy(true);
    setMessage("");
    const preview = await SchatAdmin.storagePreview([doc.cleanupKey]);
    if (!preview?.ok || !preview.previewToken) {
      setBusy(false);
      return setMessage(
        preview?.blocked?.[0]?.reason ||
          preview?.message ||
          "삭제 전 확인에서 사용 중인 자료가 발견되어 삭제하지 않았습니다."
      );
    }
    const result = await SchatAdmin.storageDelete(
      [doc.cleanupKey],
      preview.previewToken
    );
    setBusy(false);
    if (!result?.ok)
      return setMessage(result?.message || "삭제하지 못했습니다.");
    showToast("예전 문서를 삭제했습니다.", "success");
    onDeleted?.();
  }

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="예전 문서 삭제 확인"
      data-testid="old-document-delete-dialog"
    >
      <div className="w-full max-w-md rounded-xl bg-theme-bg-secondary p-5 text-sm text-theme-text-primary shadow-xl light:bg-white">
        <p className="text-base font-semibold">
          이 예전 문서를 삭제하시겠습니까?
        </p>
        <p className="mt-2 break-words font-medium">{doc.title}</p>
        <p className="mt-2">
          현재 SCHAT에서 사용되지 않는 자료만 삭제됩니다.
          <br />
          삭제 후 복구할 수 없습니다.
        </p>
        {busy && (
          <p className="mt-2 text-xs text-theme-text-secondary animate-pulse">
            서버가 다시 확인하고 삭제하는 중입니다. 1~2분 걸릴 수 있어요.
          </p>
        )}
        {message && (
          <p className="mt-2 text-xs text-red-500" role="alert">
            {message}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-theme-modal-border px-3 py-1.5 hover:bg-theme-file-picker-hover disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}
