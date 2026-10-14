import { useEffect, useMemo, useSyncExternalStore } from "react";
import ChunkViewer from "@/models/chunkViewer";
import { createChunkViewerController } from "../chunkViewerController";
import { Button, Card, Help, Notice } from "../ui";
import CurrentUsageCard from "../CurrentUsageCard";
import ChatReplay from "./ChatReplay";

// 답변 근거 보기: 질문 목록에서 질문을 고르면 직원이 실제로 본 답변 화면을
// 그대로 보여 준다(2026-10-14 사용자 요청으로 지침별 보기·검색 근거 상세 보기 제거).

function time(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ko-KR");
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
export function ChatDetail({ detail, workspaceSlug }) {
  return (
    <Card
      title="직원이 본 답변"
      help={[
        "직원 채팅 화면과 같은 방식으로 저장된 답변을 보여요.",
        "질문의 전화번호와 긴 숫자는 가려요.",
      ]}
    >
      <ChatReplay detail={detail} workspaceSlug={workspaceSlug} />
    </Card>
  );
}
export function ChunksView({ controller, state, workspace }) {
  return (
    <div className="flex flex-col gap-5">
      <Notice>
        <Help
          label="답변 근거 보기 도움말"
          heading={<span>직원이 받은 답변을 확인하는 화면입니다.</span>}
        >
          {[
            "관리자만 볼 수 있어요.",
            "질문의 전화번호와 긴 숫자는 가려요.",
            "저장된 답변을 그대로 보여 주며 새로 만들지 않아요.",
          ]}
        </Help>
      </Notice>
      {/* 넓은 화면: 왼쪽 질문 목록, 오른쪽 답변. 좁은 화면: 위아래로 쌓음. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-start">
        <div className="min-w-0 xl:max-h-[calc(100vh-10rem)] xl:overflow-y-auto">
          <Card
            title="질문 기록"
            help={[
              "질문을 누르면 직원이 본 답변 화면을 확인해요.",
              "직원 이름과 계정은 표시하지 않아요.",
            ]}
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
                    className={`rounded-lg border p-3 text-left text-sm text-theme-text-primary hover:bg-theme-bg-primary ${state.selectedChat === chat.id ? "border-sky-500 bg-theme-bg-primary" : "border-theme-sidebar-border"}`}
                  >
                    <span className="block text-xs text-theme-text-secondary">
                      {time(chat.createdAt)}
                    </span>
                    <span className="line-clamp-2 break-words">
                      {chat.question}
                    </span>
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
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {!state.selectedChat && !state.loading.detail && (
            <Notice>
              왼쪽(모바일은 위) 목록에서 질문을 누르면 직원이 본 답변이
              보입니다.
            </Notice>
          )}
          {state.loading.detail && (
            <p role="status">저장된 답변을 불러오는 중입니다.</p>
          )}
          {state.errors.detail && (
            <Notice tone="warning">
              {state.errors.detail}
              <Button
                variant="secondary"
                onClick={() => controller.openChat(state.selectedChat)}
              >
                다시 조회
              </Button>
            </Notice>
          )}
          {state.detail && (
            <ChatDetail detail={state.detail} workspaceSlug={workspace.slug} />
          )}
        </div>
      </div>
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
  useEffect(() => {
    // 지침 목록은 더 이상 보여 주지 않으므로 질문 목록만 불러온다.
    controller.start({ documents: false });
    return () => controller.stop();
  }, [controller]);
  if (!workspace) return <Notice>관리할 작업 공간을 선택해 주세요.</Notice>;
  return (
    <div className="flex flex-col gap-5">
      <CurrentUsageCard />
      <ChunksView {...{ controller, state, workspace }} />
    </div>
  );
}
