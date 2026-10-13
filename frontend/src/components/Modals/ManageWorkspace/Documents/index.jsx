import { ArrowsDownUp } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import Workspace from "../../../../models/workspace";
import showToast from "../../../../utils/toast";
import Directory from "./Directory";
import WorkspaceDirectory from "./WorkspaceDirectory";
import useDocumentPicker from "./hooks/useDocumentPicker";
import { useWorkspaceEmbeddingProgress } from "@/EmbeddingProgressContext";

export default function DocumentSettings({ workspace }) {
  const [highlightWorkspace, setHighlightWorkspace] = useState(false);
  const [movedItems, setMovedItems] = useState([]);
  // docpath → 원래 문서 이름·document_id. 처리 상태를 문서 단위로 묶을 때 씀.
  const [embedMeta, setEmbedMeta] = useState({});
  // 왼쪽 문서 목록을 다시 읽게 하는 번호(등록·업데이트가 끝날 때 올림).
  const [libraryKey, setLibraryKey] = useState(0);
  const reloadLibrary = useCallback(() => setLibraryKey((k) => k + 1), []);
  // Busy state local to the workspace (right) panel - removing embeddings.
  const [wsBusy, setWsBusy] = useState(false);
  const [wsBusyMessage, setWsBusyMessage] = useState("");
  const picker = useDocumentPicker(workspace);
  const { refresh, clearSelection, workspaceDocs: embeddedDocs } = picker;
  const hasChanges = movedItems.length > 0;

  const { embeddingProgress, startEmbedding } = useWorkspaceEmbeddingProgress(
    workspace.slug,
    {
      onProgressCleared: () => {
        refresh();
        reloadLibrary();
      },
    }
  );
  const stagedPaths = useMemo(
    () => new Set(movedItems.map((item) => `${item.folderName}/${item.name}`)),
    [movedItems]
  );

  // 왼쪽에서 고른 문서(쪽 파일들)를 오른쪽 등록 목록에 올림. 저장은 오른쪽 버튼.
  const stageFiles = useCallback((files) => {
    setMovedItems((prev) => {
      const seen = new Set(
        prev.map((item) => `${item.folderName}/${item.name}`)
      );
      return [
        ...prev,
        ...files.filter((file) => !seen.has(`${file.folderName}/${file.name}`)),
      ];
    });
  }, []);
  const unstage = useCallback(
    (ids) =>
      setMovedItems((prev) => prev.filter((item) => !ids.includes(item.id))),
    []
  );

  /**
   * Files mid-embed are shown in the workspace panel, so hide them from the
   * picker to avoid rendering the same document on both sides.
   */
  const hiddenPaths = useMemo(
    () => new Set(Object.keys(embeddingProgress ?? {})),
    [embeddingProgress]
  );

  const updateWorkspace = async (e) => {
    e?.preventDefault();
    const filenames = movedItems.map(
      (item) => `${item.folderName}/${item.name}`
    );
    setEmbedMeta((prev) => ({
      ...prev,
      ...Object.fromEntries(
        movedItems.map((item) => [
          `${item.folderName}/${item.name}`,
          {
            title: String(item.title || "")
              .split(/[\\/]/)
              .pop(),
            documentId: item.document_id || null,
          },
        ])
      ),
    }));

    setMovedItems([]);
    setHighlightWorkspace(false);
    clearSelection();

    // Fire the embed POST first so the server is already processing the job
    // by the time the SSE connection opens. This avoids the server sending
    // idle (no active job) before embedding has started.
    const embedPromise = Workspace.modifyEmbeddings(workspace.slug, {
      adds: filenames,
    });
    startEmbedding(workspace.slug, filenames);
    embedPromise.catch((error) => {
      console.error("[documents] embed request failed", error);
      showToast("문서 처리에 실패했습니다. (처리 중 오류)", "error", {
        clear: true,
      });
    });
  };

  /** Merge not-yet-embedded staged files into the workspace panel. */
  const workspaceDocs = useMemo(() => {
    if (movedItems.length === 0) return embeddedDocs;
    const items = embeddedDocs.items.map((f) => ({
      ...f,
      items: [...f.items],
    }));
    for (const moved of movedItems) {
      let folder = items.find((f) => f.name === moved.folderName);
      if (!folder) {
        folder = { name: moved.folderName, type: "folder", items: [] };
        items.push(folder);
      }
      if (!folder.items.some((item) => item.id === moved.id))
        folder.items.push(moved);
    }
    return { ...embeddedDocs, items };
  }, [embeddedDocs, movedItems]);

  const initializing = picker.status === "initializing";

  return (
    <div className="flex upload-modal -mt-6 z-10 relative">
      <Directory
        workspace={workspace}
        reloadKey={libraryKey}
        stagedPaths={stagedPaths}
        processingPaths={hiddenPaths}
        onStage={stageFiles}
        onUpdateComplete={refresh}
        setHighlightWorkspace={setHighlightWorkspace}
      />
      <div className="upload-modal-arrow">
        <ArrowsDownUp className="text-white text-base font-bold rotate-90 w-11 h-11" />
      </div>
      <WorkspaceDirectory
        workspace={workspace}
        files={workspaceDocs}
        highlightWorkspace={highlightWorkspace}
        loading={initializing || wsBusy}
        loadingMessage={wsBusyMessage}
        setLoadingMessage={setWsBusyMessage}
        setLoading={setWsBusy}
        fetchKeys={refresh}
        hasChanges={hasChanges}
        saveChanges={updateWorkspace}
        movedItems={movedItems}
        embedMeta={embedMeta}
        onUnstage={unstage}
      />
    </div>
  );
}
