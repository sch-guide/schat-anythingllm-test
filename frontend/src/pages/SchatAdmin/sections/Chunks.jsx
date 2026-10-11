import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import ChunkViewer from "@/models/chunkViewer";
import { createChunkViewerController } from "../chunkViewerController";
import { Badge, Button, Card, Notice, inputClass } from "../ui";

function time(value) {
  return value
    ? new Date(value).toLocaleString("ko-KR")
    : "등록 시각 확인 불가";
}
function Version({ item }) {
  return (
    <p className="text-xs text-theme-text-secondary">
      {item.page ? `${item.page}쪽 · ` : "페이지 확인 불가 · "}
      {item.version ? `등록 버전: ${item.version}` : "버전 확인 불가"}
      {" · "}
      {time(item.registeredAt)}
    </p>
  );
}
function Text({ children }) {
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm text-theme-text-primary max-h-[420px] overflow-auto rounded-lg bg-theme-bg-primary p-3">
      {children || "저장된 내용이 없습니다."}
    </pre>
  );
}
export function ChatEvidence({ detail }) {
  return (
    <Card
      title="저장된 답변 근거"
      description="답변 당시 저장된 발췌와 현재 조회 가능한 검색 조각을 따로 표시합니다. 발췌가 전체 원본을 뜻하지는 않습니다."
    >
      <p className="text-sm text-theme-text-primary">{detail.question}</p>
      {detail.notice && <Notice tone="warning">{detail.notice}</Notice>}
      {detail.sourcesTruncated && (
        <Notice>근거가 많아 앞의 50개만 표시합니다.</Notice>
      )}
      {!detail.sources.length && (
        <Notice>이 답변에 저장된 근거가 없습니다.</Notice>
      )}
      {detail.sources.map((source, i) => (
        <section
          key={i}
          className="flex flex-col gap-3 border-t border-theme-sidebar-border pt-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-theme-text-primary">
              {source.name}
            </h3>
            <Badge tone={source.status === "current" ? "ok" : "warning"}>
              {source.status === "previous"
                ? "이전 버전"
                : source.status === "current"
                  ? "현재 등록 자료"
                  : "원본 확인 불가"}
            </Badge>
          </div>
          <Version item={source} />
          {source.status === "previous" && (
            <Notice>검색 대상에서 제외된 이전 등록 자료입니다.</Notice>
          )}
          {source.status === "unavailable" && (
            <Notice>
              삭제 여부나 이전 버전 여부를 확인할 수 없습니다. 저장된 발췌를
              참고해 주세요.
            </Notice>
          )}
          <h4 className="text-sm font-medium text-theme-text-primary">
            저장된 발췌
          </h4>
          <Text>{source.excerpt}</Text>
          {source.excerptTruncated && (
            <Notice>발췌가 길어 앞부분만 표시합니다.</Notice>
          )}
          {source.chunk && (
            <>
              <h4 className="text-sm font-medium text-theme-text-primary">
                실제 검색 조각
              </h4>
              <Version item={source.chunk} />
              <Text>{source.chunk.text}</Text>
              {source.chunk.truncated && (
                <Notice>검색 조각이 길어 앞부분만 표시합니다.</Notice>
              )}
            </>
          )}
        </section>
      ))}
    </Card>
  );
}
function Paging({ previous, next, hasPrevious, hasNext, busy }) {
  return (
    <div className="flex gap-2">
      <Button
        variant="secondary"
        disabled={busy || !hasPrevious}
        onClick={previous}
      >
        이전 목록
      </Button>
      <Button variant="secondary" disabled={busy || !hasNext} onClick={next}>
        다음 목록
      </Button>
    </div>
  );
}
export function ChunksView({
  controller,
  state,
  workspace,
  mode,
  setMode,
  keyword,
  setKeyword,
}) {
  return (
    <div className="flex flex-col gap-5">
      <Notice>
        관리자 전용 읽기 화면입니다. 문서나 검색 조각을 수정하지 않습니다.
        질문의 전화번호·긴 숫자는 가려 표시합니다.
      </Notice>
      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="조회 방식"
      >
        <Button
          role="tab"
          aria-selected={mode === "documents"}
          variant={mode === "documents" ? "primary" : "secondary"}
          onClick={() => setMode("documents")}
        >
          문서별 검색 조각
        </Button>
        <Button
          role="tab"
          aria-selected={mode === "chats"}
          variant={mode === "chats" ? "primary" : "secondary"}
          onClick={() => setMode("chats")}
        >
          질문별 답변 근거
        </Button>
      </div>
      {mode === "documents" ? (
        <>
          <Card
            title={`${workspace.name} 문서`}
            description="등록 자료별로 조회합니다. PDF는 페이지별 자료로 나뉠 수 있습니다. 조각은 한 번에 최대 50개씩 확인합니다."
          >
            {state.loading.documents && (
              <p role="status">문서 목록을 불러오는 중입니다.</p>
            )}
            {state.errors.documents && (
              <Notice tone="warning">{state.errors.documents}</Notice>
            )}
            <Button
              variant="secondary"
              disabled={state.loading.documents}
              onClick={() => controller.documentPage(state.documentOffset)}
            >
              문서 목록 새로 고침
            </Button>
            {state.documents && (
              <>
                {!state.documents.items.length ? (
                  <Notice>등록된 문서가 없습니다.</Notice>
                ) : (
                  <label className="flex flex-col gap-2 text-sm text-theme-text-primary">
                    조회할 문서
                    <select
                      className={inputClass}
                      value={state.selectedDocument}
                      onChange={(event) => {
                        setKeyword("");
                        controller.selectDocument(event.target.value);
                      }}
                    >
                      {state.documents.items.map((doc) => (
                        <option key={doc.documentId} value={doc.documentId}>
                          {doc.name}
                          {doc.page ? ` · ${doc.page}쪽` : ""}
                          {doc.status === "previous" ? " (이전 버전)" : ""}
                          {` · ${time(doc.registeredAt)}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Paging
                  hasPrevious={state.documentOffset > 0}
                  hasNext={state.documents.hasMore}
                  busy={state.loading.documents}
                  previous={() =>
                    controller.documentPage(
                      Math.max(0, state.documentOffset - 50)
                    )
                  }
                  next={() =>
                    controller.documentPage(state.documents.nextOffset)
                  }
                />
              </>
            )}
          </Card>
          {state.selectedDocument && (
            <Card
              title="검색 조각 내용"
              description="키워드가 들어 있는 조각을 찾습니다. 검색 결과는 관련도 순위가 아닌 저장된 조각 순서입니다."
            >
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  controller.search(keyword);
                }}
              >
                <input
                  aria-label="조각 내용 검색어"
                  className={`${inputClass} max-w-[360px]`}
                  maxLength={200}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="내용에서 찾을 단어"
                />
                <Button type="submit" disabled={state.loading.chunks}>
                  검색
                </Button>
                <Button
                  variant="secondary"
                  disabled={state.loading.chunks}
                  onClick={() => controller.chunkPage(state.chunkOffset)}
                >
                  다시 조회
                </Button>
              </form>
              {state.loading.chunks && (
                <p role="status">검색 조각을 불러오는 중입니다.</p>
              )}
              {state.errors.chunks && (
                <Notice tone="warning">{state.errors.chunks}</Notice>
              )}
              {state.chunks && (
                <>
                  {state.chunks.document.status === "previous" && (
                    <Notice>
                      이 문서는 검색 대상에서 제외된 이전 버전입니다.
                    </Notice>
                  )}
                  <Version item={state.chunks.document} />
                  {state.chunks.scanLimited && (
                    <Notice>
                      한 번에 최대 1,000개 조각을 확인합니다. 다음 목록에서
                      이어서 찾을 수 있습니다.
                    </Notice>
                  )}
                  {!state.chunks.items.length && (
                    <Notice>
                      {state.chunks.hasMore
                        ? "이번 조회 구간에서 일치하는 조각이 없습니다. 다음 목록을 확인해 주세요."
                        : state.q
                          ? "일치하는 검색 조각이 없습니다."
                          : "조회 가능한 검색 조각이 없습니다."}
                    </Notice>
                  )}
                  {state.chunks.items.map((chunk) => (
                    <details
                      key={chunk.id}
                      className="rounded-lg border border-theme-sidebar-border p-3 text-theme-text-primary"
                    >
                      <summary className="cursor-pointer text-sm">
                        {chunk.page ? `${chunk.page}쪽` : "페이지 확인 불가"}
                        {chunk.section ? ` · ${chunk.section}` : ""} · 조각{" "}
                        {chunk.id}
                      </summary>
                      <div className="flex flex-col gap-2 pt-3">
                        <Version item={chunk} />
                        <Text>{chunk.text}</Text>
                        {chunk.truncated && (
                          <Notice>내용이 길어 앞부분만 표시합니다.</Notice>
                        )}
                      </div>
                    </details>
                  ))}
                  <Paging
                    hasPrevious={state.chunkHistory.length > 0}
                    hasNext={state.chunks.hasMore}
                    busy={state.loading.chunks}
                    previous={() => controller.previousChunks()}
                    next={() => controller.nextChunks()}
                  />
                </>
              )}
            </Card>
          )}
        </>
      ) : (
        <>
          <Card
            title="질문 기록"
            description="질문을 선택하면 해당 답변에 저장된 근거를 바로 확인합니다. 직원 이름·계정은 표시하지 않습니다."
          >
            <Button
              variant="secondary"
              disabled={state.loading.chats}
              onClick={() => controller.chatPage(state.chatOffset)}
            >
              질문 목록 새로 고침
            </Button>
            {state.loading.chats && (
              <p role="status">질문 기록을 불러오는 중입니다.</p>
            )}
            {state.errors.chats && (
              <Notice tone="warning">{state.errors.chats}</Notice>
            )}
            {state.chats && (
              <>
                {!state.chats.items.length && (
                  <Notice>이 작업 공간의 질문 기록이 없습니다.</Notice>
                )}
                {state.chats.items.map((chat) => (
                  <button
                    type="button"
                    key={chat.id}
                    aria-pressed={state.selectedChat === chat.id}
                    onClick={() => controller.openChat(chat.id)}
                    className="rounded-lg border border-theme-sidebar-border p-3 text-left text-sm text-theme-text-primary hover:bg-theme-bg-primary"
                  >
                    <span className="block text-xs text-theme-text-secondary">
                      {time(chat.createdAt)}
                    </span>
                    {chat.question}
                  </button>
                ))}
                <Paging
                  hasPrevious={state.chatOffset > 0}
                  hasNext={state.chats.hasMore}
                  busy={state.loading.chats}
                  previous={() =>
                    controller.chatPage(Math.max(0, state.chatOffset - 50))
                  }
                  next={() => controller.chatPage(state.chats.nextOffset)}
                />
              </>
            )}
          </Card>
          {state.loading.detail && (
            <p role="status">저장된 답변 근거를 불러오는 중입니다.</p>
          )}
          {state.errors.detail && (
            <Notice tone="warning">
              {state.errors.detail}
              <Button
                variant="secondary"
                onClick={() => controller.openChat(state.selectedChat)}
              >
                근거 다시 조회
              </Button>
            </Notice>
          )}
          {state.detail && <ChatEvidence detail={state.detail} />}
        </>
      )}
    </div>
  );
}
export default function ChunksSection({ workspace }) {
  const controller = useMemo(
    () => createChunkViewerController(ChunkViewer, workspace?.id),
    [workspace?.id]
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  );
  const [mode, setMode] = useState("documents");
  const [keyword, setKeyword] = useState("");
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  useEffect(() => {
    setKeyword("");
  }, [workspace?.id, state.selectedDocument]);
  if (!workspace) return <Notice>관리할 작업 공간을 선택해 주세요.</Notice>;
  return (
    <ChunksView
      {...{ controller, state, workspace, mode, setMode, keyword, setKeyword }}
    />
  );
}
