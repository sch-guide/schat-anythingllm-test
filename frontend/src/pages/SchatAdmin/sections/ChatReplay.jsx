import PromptReply from "@/components/WorkspaceChat/ChatContainer/ChatHistory/PromptReply";
import { ChatSidebarProvider } from "@/components/WorkspaceChat/ChatContainer/ChatSidebar";
import { Notice } from "../ui";

// 질문별 보기의 "답변 원문 보기".
// 직원 채팅 화면이 쓰는 답변 컴포넌트(PromptReply)를 그대로 사용해
// Markdown·표·출처·관련 그림이 채팅과 같은 모양으로 보이게 한다.
// 저장된 질문·답변만 보여 주며 새로 만들거나 요약하지 않는다.
export default function ChatReplay({ detail, workspaceSlug }) {
  const answer = detail.answer;
  if (!answer) {
    return (
      <Notice tone="warning">
        이 기록의 답변 원문을 불러오지 못했습니다. 질문 목록을 새로 고친 뒤
        다시 선택해 주세요.
      </Notice>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {answer.missing?.length > 0 && (
        <Notice tone="warning">
          예전 기록이라 {answer.missing.join("·")}이(가) 저장되어 있지 않아
          저장된 범위까지만 표시합니다.
        </Notice>
      )}
      {answer.textTruncated && (
        <Notice>답변이 매우 길어 앞부분만 표시합니다.</Notice>
      )}
      <div
        data-testid="chat-replay"
        className="rounded-xl bg-theme-bg-secondary px-1 md:px-3 text-white light:text-slate-900"
      >
        <div className="flex justify-end w-full">
          <div className="py-4 px-4 flex flex-col items-end">
            <div className="bg-zinc-800 light:bg-slate-100 rounded-[20px] rounded-br-none px-4 py-3.5 max-w-[600px] whitespace-pre-wrap break-words">
              {detail.question}
            </div>
          </div>
        </div>
        {answer.available ? (
          <ChatSidebarProvider>
            <PromptReply
              uuid={`admin-replay-${detail.id}`}
              reply={answer.text}
              sources={answer.sources || []}
              presentation={answer.presentation}
              relatedImages={answer.relatedImages || []}
              citationQuestion={detail.question}
              workspaceSlug={workspaceSlug}
            />
          </ChatSidebarProvider>
        ) : (
          <p className="px-4 py-4 text-sm text-theme-text-secondary">
            저장된 답변 본문이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
