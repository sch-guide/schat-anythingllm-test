import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import ChunkViewer from "@/models/chunkViewer";
import { createChunkViewerController } from "../chunkViewerController";
import { Button, Card, Help, Notice } from "../ui";
import ChatReplay from "./ChatReplay";
import UsageStatsSection from "./UsageStats";

// 질문·답변 기록(2026-10-17): 예전 '사용 통계'와 '답변 근거 보기'를 한 메뉴의 두 탭으로 합침.
// - [통계] 탭: 합계만 보여 준다. 주제·문서·검색 실패·근거 없음 항목을 누르면
//   [질문별 답변] 탭에서 그 질문만 보여 준다. 부서별 사용량은 누를 수 없다.
// - [질문별 답변] 탭: 질문을 고르면 직원이 실제로 본 답변 화면을 그대로 보여 준다.
//   질문한 직원은 부서와 사번만 보여 준다(이름은 보이지 않음).

const TABS = [
  ["stats", "통계"],
  ["chats", "질문별 답변"],
];

function time(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ko-KR");
}
/** "92병동 · 사번 20152" (없는 값은 빼고, 둘 다 없으면 "부서·사번 없음") */
export function askerLabel(chat = {}) {
  const parts = [
    chat.department,
    chat.employeeNumber ? `사번 ${chat.employeeNumber}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "부서·사번 없음";
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
function Asker({ detail }) {
  return (
    <div
      className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-secondary"
      data-testid="chat-asker"
    >
      <span>
        부서{" "}
        <b className="text-theme-text-primary">{detail.department || "없음"}</b>
      </span>
      <span>
        사번{" "}
        <b className="text-theme-text-primary">
          {detail.employeeNumber || "없음"}
        </b>
      </span>
      <span>
        시각 <b className="text-theme-text-primary">{time(detail.createdAt)}</b>
      </span>
    </div>
  );
}
export function ChatDetail({ detail, workspaceSlug }) {
  return (
    <Card
      title="직원이 본 답변"
      help={[
        "직원 채팅 화면과 같은 방식으로 저장된 답변을 보여요.",
        "체크리스트 버튼도 직원 화면처럼 보여요. 버튼 여부는 저장되지 않아 지금 등록된 체크리스트 기준이에요.",
        "질문한 직원은 부서와 사번만 보여요. 이름은 보이지 않아요.",
        "질문의 전화번호와 긴 숫자는 가려요.",
      ]}
    >
      <Asker detail={detail} />
      <ChatReplay detail={detail} workspaceSlug={workspaceSlug} />
    </Card>
  );
}
export function ChunksView({ controller, state, workspace }) {
  return (
    <div className="flex flex-col gap-5">
      <Notice>
        <Help
          label="질문별 답변 도움말"
          heading={<span>직원이 받은 답변을 확인하는 화면입니다.</span>}
        >
          {[
            "관리자만 볼 수 있어요.",
            "질문한 직원은 부서와 사번만 보여요. 이름은 보이지 않아요.",
            "질문의 전화번호와 긴 숫자는 가려요.",
            "저장된 답변을 그대로 보여 주며 새로 만들지 않아요.",
          ]}
        </Help>
      </Notice>
      {state.filter && (
        <div
          className="flex flex-wrap items-center gap-2 text-sm text-theme-text-secondary"
          data-testid="chat-filter"
        >
          보는 중
          <span className="inline-flex items-center gap-2 rounded-full bg-sky-500/15 px-3 py-1 font-semibold text-theme-text-primary">
            {state.filter.label}
            <button
              type="button"
              aria-label="조건 지우고 전체 질문 보기"
              onClick={() => controller.clearFilter()}
              className="text-theme-text-secondary hover:text-theme-text-primary"
            >
              ✕
            </button>
          </span>
          {Number.isFinite(state.chats?.total) && (
            <span>{state.chats.total.toLocaleString("ko-KR")}건</span>
          )}
          {state.filter.startDate && (
            <span>
              ({state.filter.startDate} ~ {state.filter.endDate})
            </span>
          )}
        </div>
      )}
      {/* 넓은 화면: 왼쪽 질문 목록, 오른쪽 답변. 좁은 화면: 위아래로 쌓음. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-start">
        <div className="min-w-0 xl:max-h-[calc(100vh-10rem)] xl:overflow-y-auto">
          <Card
            title="질문 기록"
            help={[
              "질문을 누르면 직원이 본 답변 화면을 확인해요.",
              "질문한 직원은 부서와 사번만 보여요.",
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
                  <Notice>
                    {state.filter
                      ? "이 조건에 맞는 질문이 이 작업 공간에 없습니다."
                      : "이 작업 공간의 질문 기록이 없습니다."}
                  </Notice>
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
                      <span className="font-medium text-theme-text-primary">
                        {askerLabel(chat)}
                      </span>
                      {" · "}
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
  const [tab, setTab] = useState("stats");
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
  // 통계에서 항목을 누르면 질문별 답변 탭에서 그 질문만 보여 준다.
  function pick({ chatId = null, ...filter }) {
    setTab("chats");
    controller.applyFilter(filter, chatId);
  }
  return (
    <div className="flex flex-col gap-5">
      <div
        className="flex gap-1 border-b border-theme-sidebar-border"
        role="tablist"
        aria-label="질문·답변 기록"
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-[3px] px-4 py-2.5 text-sm ${
              tab === key
                ? "border-sky-500 font-semibold text-theme-text-primary"
                : "border-transparent text-theme-text-secondary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={tab === "stats" ? "" : "hidden"}>
        <UsageStatsSection onPick={workspace ? pick : null} />
      </div>
      <div className={tab === "chats" ? "flex flex-col gap-5" : "hidden"}>
        {workspace ? (
          <>
            <ChunksView {...{ controller, state, workspace }} />
          </>
        ) : (
          <Notice>관리할 작업 공간을 선택해 주세요.</Notice>
        )}
      </div>
    </div>
  );
}
