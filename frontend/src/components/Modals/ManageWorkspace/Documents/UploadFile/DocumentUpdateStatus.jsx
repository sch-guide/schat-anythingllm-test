import { useEffect, useRef } from "react";

export default function DocumentUpdateStatus({ state, onConfirm, onCancel }) {
  const dialog = useRef(null);
  const confirming = state.phase === "confirming";
  useEffect(() => {
    if (confirming && !dialog.current.open) dialog.current.showModal();
    if (!confirming && dialog.current.open) dialog.current.close();
  }, [confirming]);
  return (
    <>
      <dialog
        ref={dialog}
        aria-labelledby="document-update-title"
        onCancel={(event) => {
          event.preventDefault();
          onCancel();
        }}
        className="w-[calc(100%-2rem)] max-w-lg max-h-[85vh] overflow-auto rounded-xl border border-theme-modal-border bg-theme-bg-primary text-theme-text-primary p-5 backdrop:bg-black/60"
      >
        <h3 id="document-update-title" className="text-lg font-semibold">
          기존 자료가 있습니다. 기존 자료를 지우고 업데이트하시겠습니까?
        </h3>
        <p className="mt-3 text-sm">
          이전 자료는 검색에서 제외하고 새 자료로 바꿉니다. 이전 원본과 과거
          답변의 출처는 보존합니다. 체크리스트는 새 자료에서 다시 만들며,
          이전과 같으면 기존 공개·수정 상태를 이어받고 달라졌으면 검토
          대기로 들어갑니다. 퀴즈는 근거 문장이 새 자료에 그대로 있는 것만
          계속 쓰고, 숫자가 바뀌었거나 찾지 못한 퀴즈는 이전 문서로 돌립니다.
        </p>
        <p className="mt-3 text-sm">같은 이름의 자료</p>
        <ul className="my-2 max-h-48 overflow-auto list-disc pl-5 text-sm">
          {(state.conflicts || []).map((conflict) => (
            <li className="break-all py-1" key={conflict.name}>
              {conflict.name} — 기존 자료 {conflict.documents.length}개
            </li>
          ))}
        </ul>
        <p className="text-sm">
          취소하면 함께 선택한 파일 {state.count || 0}개를 모두 올리지 않습니다.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded-lg border border-theme-modal-border px-4 py-2"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-primary-button text-white px-4 py-2"
          >
            업데이트
          </button>
        </div>
      </dialog>
      {["checking", "updating"].includes(state.phase) && (
        <p role="status" className="mt-3 text-sm text-theme-text-primary">
          {state.phase === "checking"
            ? "전체 파일의 기존 자료를 확인하고 있습니다. 아직 파일을 올리지 않았습니다."
            : "문서를 업데이트하고 있습니다. 결과가 나올 때까지 기다려 주세요."}
        </p>
      )}
      {state.phase === "error" && (
        <p role="alert" className="mt-3 text-sm text-red-400 break-words">
          {state.error}
        </p>
      )}
      {state.phase === "complete" && (
        <section
          aria-label="문서 업데이트 결과"
          className="mt-3 rounded-lg border border-theme-modal-border p-3 text-sm text-theme-text-primary"
        >
          <p role="status" className="font-semibold">
            문서 업데이트를 완료했습니다.
          </p>
          {state.result.quizRelink && (
            <p className="mt-2 font-semibold" data-testid="quiz-relink-summary">
              퀴즈 {state.result.quizRelink.total}개 중 계속 사용{" "}
              {state.result.quizRelink.kept} · 이전 문서{" "}
              {state.result.quizRelink.outdated}
            </p>
          )}
          <p className="mt-2">
            이전 원본과 아래 연결은 보존했습니다. 체크리스트와 과거 답변 출처는
            새 자료로 자동 이전하지 않았으므로 내용을 검토해 주세요.
          </p>
          {[
            ["checklists", "체크리스트"],
            ["quizzes", "퀴즈"],
            ["pastSources", "과거 답변 출처"],
          ].map(([key, label]) => {
            const entries = state.result.relatedItems?.[key];
            return (
              <div key={key} className="mt-3">
                <h4 className="font-semibold">{label}</h4>
                {Array.isArray(entries) ? (
                  entries.length ? (
                    <ul className="list-disc pl-5 max-h-40 overflow-auto">
                      {entries.map((item, index) => (
                        <li
                          className="break-all"
                          key={`${item.id || index}-${key}`}
                        >
                          {item.title ||
                            item.name ||
                            item.documentName ||
                            item.docpath ||
                            `${label} #${item.id || item.chatId || index + 1}`}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>연결된 항목 없음</p>
                  )
                ) : (
                  <p>
                    연결 목록을 받지 못했습니다. 관리자 화면에서 확인해 주세요.
                  </p>
                )}
              </div>
            );
          })}
          {(state.result.warnings || []).map((warning, index) => (
            <p role="alert" key={index} className="mt-2">
              {typeof warning === "string"
                ? warning
                : warning.message || "추가 확인이 필요합니다."}
            </p>
          ))}
        </section>
      )}
    </>
  );
}
