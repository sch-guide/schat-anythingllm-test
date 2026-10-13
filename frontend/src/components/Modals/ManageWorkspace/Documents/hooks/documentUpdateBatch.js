// Keeps every file outside the upload queue until the entire batch is checked.
export function createDocumentUpdateBatch({
  preview,
  upload,
  replace,
  onState,
}) {
  let phase = "idle";
  let pending = null;
  let generation = 0;
  let disposed = false;
  const publish = (state) => {
    phase = state.phase;
    onState(state);
  };
  return {
    invalidate() {
      disposed = true;
      generation++;
      pending = null;
      phase = "idle";
    },
    async prepare(items) {
      if (disposed) return false;
      if (["checking", "confirming", "updating"].includes(phase)) return false;
      if (!items.length) return false;
      const current = generation;
      publish({ phase: "checking" });
      try {
        if (items.some((item) => item.rejected))
          throw new Error(
            "PDF가 아닌 파일처럼 올릴 수 없는 파일이 포함되어 있습니다. PDF 파일만 다시 선택해 주세요."
          );
        const result = await preview(items.map(({ file }) => file.name));
        if (current !== generation) return false;
        if (
          result?.success !== true ||
          !Array.isArray(result.conflicts) ||
          result.conflicts.some(
            (conflict) =>
              typeof conflict.name !== "string" ||
              !Array.isArray(conflict.documents) ||
              !conflict.documents.length ||
              conflict.documents.some(
                (doc) => typeof doc.docpath !== "string" || !doc.documentId
              )
          )
        )
          throw new Error(
            result?.error ||
              "기존 자료를 확인하지 못했습니다. 파일은 올리지 않았습니다."
          );
        if (!result.conflicts.length) {
          upload(items);
          publish({ phase: "idle" });
          return true;
        }
        pending = { items, conflicts: result.conflicts };
        publish({
          phase: "confirming",
          conflicts: result.conflicts,
          count: items.length,
        });
        return true;
      } catch (error) {
        if (current !== generation) return false;
        publish({ phase: "error", error: error.message });
        return false;
      }
    },
    cancel() {
      if (phase !== "confirming") return;
      pending = null;
      publish({ phase: "idle" });
    },
    async confirm() {
      if (disposed) return;
      if (phase !== "confirming" || !pending) return;
      const { items, conflicts } = pending;
      const current = generation;
      pending = null;
      publish({ phase: "updating" });
      try {
        const result = await replace(items, conflicts);
        if (current !== generation) return;
        if (result?.success !== true)
          throw new Error(
            result?.error || "문서 업데이트를 완료하지 못했습니다."
          );
        publish({ phase: "complete", result });
      } catch (error) {
        if (current !== generation) return;
        publish({
          phase: "error",
          error: `${error.message} 일반 업로드로 전환하지 않았습니다. 문서 목록을 확인한 뒤 다시 시도해 주세요.`,
        });
      }
    },
  };
}
