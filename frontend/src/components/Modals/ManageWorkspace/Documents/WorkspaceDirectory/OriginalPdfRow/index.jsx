import { FilePdf } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { toast } from "react-toastify";
import Workspace from "@/models/workspace";
import ChecklistList from "./ChecklistList";

export default function OriginalPdfRow({
  row,
  selectionState,
  toggleSelection,
  disableSelection = false,
  workspaceSlug,
  onOriginalLinked,
  checklists = [],
  onChecklistUpdated,
}) {
  const selected = selectionState === "all";
  const partial = selectionState === "some";
  const inputRef = useRef(null);
  const [linking, setLinking] = useState(false);

  function handleSelection(event) {
    event.stopPropagation();
    if (!disableSelection) toggleSelection();
  }

  function openOriginalPicker(event) {
    event.stopPropagation();
    inputRef.current?.click();
  }

  async function linkOriginal(event) {
    event.stopPropagation();
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !row.pdfRef || !workspaceSlug) return;
    if (
      !/\.pdf$/i.test(file.name) ||
      !["application/pdf", "application/octet-stream", ""].includes(file.type)
    ) {
      toast.error("PDF 파일만 연결할 수 있습니다.");
      return;
    }

    setLinking(true);
    try {
      const { response, data } = await Workspace.linkOriginalPdf(
        workspaceSlug,
        row.pdfRef,
        file
      );
      if (!response.ok || !data.success)
        throw new Error(data.error || "원본 PDF 연결에 실패했습니다.");
      toast.success("원본 PDF가 연결됐습니다.");
      await onOriginalLinked?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLinking(false);
    }
  }

  return (
    <div
      aria-label={`원본 PDF ${row.title}`}
      className={`file-row grid min-h-[48px] w-full min-w-0 grid-cols-12 items-center py-2 pl-3.5 pr-4 text-xs text-theme-text-primary ${
        disableSelection
          ? ""
          : "cursor-pointer hover:bg-theme-file-picker-hover"
      } ${selected ? "selected light:text-white" : ""}`}
      onClick={handleSelection}
    >
      <div className="col-span-12 flex min-w-0 items-center gap-x-2">
        <div className="h-3 w-3 shrink-0">
          {!disableSelection && (
            <div
              aria-label={`${row.title} 전체 선택`}
              aria-checked={partial ? "mixed" : selected}
              className={`flex h-3 w-3 cursor-pointer items-center justify-center rounded border border-solid border-white ${
                selected || partial
                  ? "text-white"
                  : "text-theme-text-primary light:invert"
              }`}
              role="checkbox"
              tabIndex={0}
              onClick={handleSelection}
            >
              {selected && <div className="h-2 w-2 rounded-[2px] bg-white" />}
              {partial && <div className="h-[2px] w-2 bg-white" />}
            </div>
          )}
        </div>
        <FilePdf
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-theme-text-primary"
          weight="fill"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{row.title}</p>
          {row.pageCount > 0 && (
            <p className="text-[10px] text-theme-text-secondary">
              {row.pageCount}페이지
            </p>
          )}
          <ChecklistList
            checklists={checklists}
            workspaceSlug={workspaceSlug}
            onUpdated={onChecklistUpdated}
          />
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onClick={(event) => event.stopPropagation()}
          onChange={linkOriginal}
        />
        {row.originalPdfAvailable ? (
          <span className="shrink-0 text-[10px] font-medium text-green-400 light:text-green-700">
            원본 연결됨
          </span>
        ) : (
          <button
            type="button"
            disabled={!row.pdfRef || linking}
            onClick={openOriginalPicker}
            className="shrink-0 rounded border border-theme-modal-border px-2 py-1 text-[10px] font-medium hover:bg-theme-file-picker-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {linking ? "연결 중..." : "원본 PDF 연결"}
          </button>
        )}
      </div>
    </div>
  );
}
