import { useEffect, useState } from "react";
import System from "@/models/system";
import SchatAdmin from "@/models/schatAdmin";
import { Badge, Button, Card, InfoRow, Loading, Notice } from "../ui";

// Plain-language names for the system records admins are likely to see.
export const EVENT_LABELS = {
  login_event: "로그인",
  failed_login_invalid_password: "로그인 실패 (비밀번호 오류)",
  failed_login_invalid_username: "로그인 실패 (없는 아이디)",
  sent_chat: "질문 전송",
  document_uploaded: "문서 업로드",
  document_uploaded_to_chat: "대화에 파일 첨부",
  workspace_file_uploaded: "작업 공간에 문서 업로드",
  workspace_documents_added: "검색 문서 추가",
  workspace_documents_removed: "검색 문서 제거",
  workspace_created: "작업 공간 생성",
  workspace_deleted: "작업 공간 삭제",
  workspace_thread_created: "새 대화 생성",
  workspace_prompt_changed: "답변 규칙 변경",
  user_created: "사용자 추가",
  user_deleted: "사용자 관리 기록: 계정 삭제",
  user_updated: "사용자 정보 변경",
  invite_created: "초대 링크 생성",
  invite_deleted: "초대 링크 삭제",
  multi_user_mode_enabled: "다중 사용자 모드 사용",
  update_llm_provider: "AI 답변 서비스 설정 변경",
  update_embedding_engine: "검색 임베딩 설정 변경",
  update_vector_db: "검색 데이터 저장소 설정 변경",
  event_logs_cleared: "시스템 기록 삭제",
  schat_connection_test: "연결 테스트",
  failed_login_employee: "로그인 실패 (직원 로그인)",
  failed_login_account_suspended: "로그인 실패 (사용중지 계정)",
  users_bulk_created: "직원 일괄등록",
  user_password_reset: "비밀번호 초기화",
  user_password_changed: "비밀번호 변경",
};

// Audit detail for account deletion (name, department, number only).
function deletedLabel(metadata) {
  try {
    const m = JSON.parse(metadata || "{}");
    const parts = [m.name, m.department, m.employeeNumber].filter(Boolean);
    return parts.length ? ` · ${parts.join(" · ")}` : "";
  } catch {
    return "";
  }
}

export function eventLabel(event = "") {
  return EVENT_LABELS[event] || "기타 시스템 기록";
}

function formatNumber(value) {
  return typeof value === "number"
    ? value.toLocaleString("ko-KR")
    : "확인 불가";
}

export default function StatusSection() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    SchatAdmin.status().then((value) => setStatus(value || { error: true }));
  }, []);

  if (!status) return <Loading />;
  if (status.error)
    return <Notice tone="warning">시스템 상태를 불러오지 못했습니다.</Notice>;

  const { workspaces = [], checklists, connections } = status;
  return (
    <div className="flex flex-col gap-y-5">
      <Card
        title="문서와 검색 데이터"
        description="읽기 전용 정보입니다. 문서 추가·삭제는 작업 공간의 문서 업로드에서 합니다."
      >
        {workspaces.map((ws) => (
          <div key={ws.slug}>
            {workspaces.length > 1 && (
              <p className="text-sm font-semibold text-theme-text-primary mb-1">
                {ws.name}
              </p>
            )}
            <InfoRow label="등록 문서 수">
              {formatNumber(ws.documents?.files)}개 (검색용{" "}
              {formatNumber(ws.documents?.pages)}쪽)
            </InfoRow>
            <InfoRow label="검색 데이터(벡터) 수">
              {formatNumber(ws.vectors)}개
            </InfoRow>
            <InfoRow label="답변 규칙">
              {ws.inheritsDefaultPrompt
                ? "기본 답변 규칙 사용"
                : "작업 공간 별도 규칙 사용"}
            </InfoRow>
          </div>
        ))}
        <InfoRow label="체크리스트 수">
          {checklists
            ? `${formatNumber(checklists.total)}개 (사용 중 ${formatNumber(checklists.active)} · 검토 필요 ${formatNumber(checklists.review)})`
            : "확인 불가"}
        </InfoRow>
      </Card>
      <Card
        title="연결 상태"
        description="API 키가 등록되어 있는지 보여 줍니다. 실제 연결 여부는 '시스템 연결'의 연결 테스트로 확인할 수 있습니다."
      >
        <InfoRow label="AI 답변">
          <KeyBadge info={connections?.llm} />
        </InfoRow>
        <InfoRow label="검색 임베딩">
          <KeyBadge info={connections?.embedding} />
        </InfoRow>
      </Card>
      <RecentEvents />
    </div>
  );
}

function KeyBadge({ info }) {
  if (!info) return "확인 불가";
  return info.keySet ? (
    <Badge tone="ok">API 키 등록됨 · {info.model || "모델 미설정"}</Badge>
  ) : (
    <Badge tone="warning">API 키 미등록</Badge>
  );
}

function RecentEvents() {
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    System.eventLogs(page).then((value) => setData(value || { logs: [] }));
  }, [page]);

  return (
    <Card
      title="시스템 기록"
      description="로그인, 문서 업로드, 설정 변경 같은 최근 기록입니다. 오류가 의심되면 이 기록을 기술 담당자에게 알려 주세요."
    >
      {!data ? (
        <Loading />
      ) : data.logs?.length ? (
        <>
          <ul className="flex flex-col">
            {data.logs.map((log) => (
              <li
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-theme-sidebar-border last:border-b-0"
              >
                <span className="text-sm text-theme-text-primary">
                  {eventLabel(log.event)}
                  {log.event === "user_deleted" && deletedLabel(log.metadata)}
                </span>
                <span className="text-xs text-theme-text-secondary">
                  {log.user?.username && log.user.username !== "unknown user"
                    ? `${log.user.username} · `
                    : ""}
                  {new Date(log.occurredAt).toLocaleString("ko-KR")}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-x-2">
            <Button
              variant="secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              최근 기록
            </Button>
            <Button
              variant="secondary"
              disabled={!data.hasPages}
              onClick={() => setPage((p) => p + 1)}
            >
              이전 기록
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-theme-text-secondary">기록이 없습니다.</p>
      )}
    </Card>
  );
}
