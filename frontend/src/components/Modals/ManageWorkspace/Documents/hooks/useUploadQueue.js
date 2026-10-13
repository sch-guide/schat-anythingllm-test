import { useCallback, useEffect, useRef, useState } from "react";
import { v4 } from "uuid";
import System from "@/models/system";
import { groupDroppedFiles, groupFilesIntoFolder } from "@/utils/folderUpload";
import Workspace from "@/models/workspace";
import { createDocumentUpdateBatch } from "./documentUpdateBatch";
import { isSupportedDocumentFile } from "../uploadStatus";

/**
 * The queue of in-flight uploads, shared by every drop target in the picker.
 *
 * There are two ways to start an upload and they must feed the same queue and
 * the same progress list: the dropzone under the picker, where the drop's own
 * folder structure decides the destination, and an individual folder row,
 * where the user has named the destination by dropping onto it.
 */
export default function useUploadQueue(workspace) {
  /** Whether the document processor is up; nothing can be uploaded if not. */
  const [ready, setReady] = useState(false);
  const [files, setFiles] = useState([]);
  const [updateState, setUpdateState] = useState({ phase: "idle" });
  const filesRef = useRef(files);
  filesRef.current = files;
  const [batch, setBatch] = useState(null);
  useEffect(() => {
    const activeBatch = createDocumentUpdateBatch({
        preview: (names) =>
          Workspace.previewDocumentUpdate(workspace.slug, names),
        upload: setFiles,
        replace: (items, conflicts) =>
          Workspace.replaceDocumentBatch(workspace.slug, items, conflicts),
        onState: setUpdateState,
      });
    setBatch(activeBatch);
    setUpdateState({ phase: "idle" });
    return () => activeBatch.invalidate();
  }, [workspace.slug]);
  const prepare = useCallback(
    (items) => {
      if (filesRef.current.length) return Promise.resolve(false);
      return batch ? batch.prepare(items) : Promise.resolve(false);
    },
    [batch]
  );

  useEffect(() => {
    let cancelled = false;
    System.checkDocumentProcessorOnline().then((online) => {
      if (!cancelled) setReady(online);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Queue a drop on the main dropzone. Loose files land in custom-documents;
   * a dropped folder becomes a folder of the same name.
   * @param {File[]} accepted
   * @param {Array<{file: File, errors: Array<{code: string}>}>} rejections
   */
  const enqueueDrop = useCallback(
    (accepted = [], rejections = []) => {
      const grouped = groupDroppedFiles(accepted);
      return prepare([
        ...grouped.looseFiles.map((file) => ({ uid: v4(), file })),
        ...grouped.folders.flatMap(({ folderName, files: folderFiles }) =>
          folderFiles.map(({ file, relativePath }) => ({
            uid: v4(),
            file,
            folderName,
            relativePath,
          }))
        ),
        ...rejections.map((rejection) => ({
          uid: v4(),
          file: rejection.file,
          rejected: true,
          reason: rejection.errors[0].code,
        })),
      ]);
    },
    [prepare]
  );

  /**
   * Queue a drop that was aimed at a specific folder row.
   * @param {File[]} accepted
   * @param {string} folderName
   * @returns {{queued: number, skipped: number}}
   */
  const enqueueIntoFolder = useCallback(
    async (accepted = [], folderName) => {
      const { files: targeted, skipped } = groupFilesIntoFolder(
        accepted,
        folderName
      );
      if (targeted.length > 0) {
        // 폴더 끌어놓기도 파일 선택과 같은 형식만 등록함.
        const acceptedBatch = await prepare(
          targeted.map(({ file, relativePath }) =>
            isSupportedDocumentFile(file)
              ? { uid: v4(), file, folderName, relativePath }
              : {
                  uid: v4(),
                  file,
                  rejected: true,
                  reason: "file-invalid-type",
                }
          )
        );
        if (!acceptedBatch) return { queued: 0, skipped, blocked: true };
      }
      return { queued: targeted.length, skipped };
    },
    [prepare]
  );

  const busy =
    files.length > 0 ||
    ["checking", "confirming", "updating"].includes(updateState.phase);
  return {
    ready,
    busy,
    updateState,
    confirmUpdate: batch?.confirm,
    cancelUpdate: batch?.cancel,
    files,
    setFiles,
    enqueueDrop,
    enqueueIntoFolder,
  };
}
