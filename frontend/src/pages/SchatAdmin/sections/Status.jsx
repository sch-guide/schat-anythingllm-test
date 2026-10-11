import { useEffect, useRef, useState } from "react";
import System from "@/models/system";
import SchatAdmin from "@/models/schatAdmin";
import { Button, Card, InfoRow, Loading, Notice } from "../ui";
import GeminiBudgetPanel from '../GeminiBudgetPanel';
import ConnectionsSection from './Connections';
import ChatAdmissionPanel from '../ChatAdmissionPanel';
import { useGeminiAvailability } from '../GeminiAvailabilityBanner';
import { SystemLights } from '../SystemOverview';
import { Link } from 'react-router-dom';

// Plain-language names for the system records admins are likely to see.
export const EVENT_LABELS = {
  schat_gemini_exhausted: 'Gemini 한도 소진 감지',
  schat_gemini_recovered: 'Gemini 정상 복구',
  schat_gemini_busy_repeated: 'Gemini 일시적 혼잡 반복 발생',
  login_event: "로그인",
  failed_login_invalid_password: "로그인 실패 (비밀번호 오류)",
  failed_login_invalid_username: "로그인 실패 (없는 아이디)",
  sent_chat: "질문 전송",
  document_uploaded: "문서 업로드",
  checklist_extraction_issue: "체크리스트 자동 추출 실패",
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
  update_embedding_engine: "문서 검색 설정 변경",
  update_vector_db: "검색 데이터 저장소 설정 변경",
  event_logs_cleared: "시스템 기록 삭제",
  schat_connection_test: "연결 테스트",
  failed_login_employee: "로그인 실패 (직원 로그인)",
  failed_login_account_suspended: "로그인 실패 (사용중지 계정)",
  users_bulk_created: "직원 일괄등록",
  user_password_reset: "비밀번호 초기화",
  user_password_changed: "비밀번호 변경",
  schat_department_deleted: "부서 삭제",
  schat_storage_cleanup: "저장공간 정리",
  schat_original_pdf_cleanup: "연결되지 않은 원본 PDF 삭제",
};

const CHECKLIST_ISSUE_TEXT = {
  "pdf-layout-unavailable": "원본 PDF를 읽지 못함",
  "layout-not-recognised": "표 모양을 읽지 못함",
  "extract-failed": "추출 오류",
  "read-failed": "쪽 기록을 읽지 못함",
  "save-failed": "저장 오류",
};

// Which pages failed checklist extraction and why (no page text).
export function checklistIssueLabel(metadata) {
  try {
    const m = JSON.parse(metadata || "{}");
    const reasons = Object.keys(JSON.parse(m.reasons || "{}"))
      .map((code) => CHECKLIST_ISSUE_TEXT[code] || code)
      .join(", ");
    const pages = m.failedPages ? `p.${m.failedPages}` : "";
    return [pages, reasons].filter(Boolean).length
      ? ` · ${[pages, reasons].filter(Boolean).join(" · ")}`
      : "";
  } catch {
    return "";
  }
}

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

// Department name, or how many original PDFs were removed and the space freed.
export function cleanupLabel(event, metadata) {
  try {
    const m = JSON.parse(metadata || "{}");
    if (event === "schat_department_deleted")
      return m.name ? ` · ${m.name}` : "";
    if (event === "schat_original_pdf_cleanup") {
      const mb = Math.round(Number(m.freedBytes || 0) / 1024 ** 2);
      return ` · ${Number(m.deleted || 0)}개 삭제 · 확보 공간 ${mb}MB`;
    }
  } catch {}
  return "";
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
  const [admission, setAdmission] = useState(null);
  const [details, setDetails] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionResult, setConnectionResult] = useState(null);
  const connectionRevision = useRef(0);
  const { data: availability, error: availabilityError } = useGeminiAvailability();

  useEffect(() => {
    let active = true;
    SchatAdmin.status().then((value) => { if(active) setStatus(value || { error: true }); })
      .catch(() => { if(active) setStatus({error:true}); });
    return () => { active=false; };
  }, []);

  async function testConnections() {
    const revision = connectionRevision.current;
    setTesting(true);
    setConnectionResult(null);
    try {
      const results = await Promise.all(['llm','embedding'].map(target => SchatAdmin.connectionTest(target)));
      if (revision === connectionRevision.current)
        setConnectionResult({ ok: results.every(result => result?.ok === true) });
    } catch { if (revision === connectionRevision.current) setConnectionResult({ ok:false }); }
    finally { setTesting(false); }
  }

  async function connectionSaved() {
    connectionRevision.current += 1;
    setConnectionResult(null);
    try { setStatus(await SchatAdmin.status() || {error:true}); }
    catch { setStatus({error:true}); }
  }

  if (!status) return <Loading />;
  if (status.error)
    return <Notice tone="warning">시스템 상태를 불러오지 못했습니다.</Notice>;

  const { workspaces = [], checklists, connections } = status;
  return (
    <div className="flex flex-col gap-y-5">
      <SystemLights ai={availability?.state} aiError={availabilityError} daily={admission?.dailyUsage}
        connections={connections} connectionResult={connectionResult} />
      <Button className="self-start" variant="secondary" onClick={testConnections} disabled={testing}>
        {testing ? '확인 중…' : '연결 시험'}
      </Button>
      <ChatAdmissionPanel onState={setAdmission} showDaily={false} />
      <Card
        title="등록 지침과 체크리스트"
        help="지침 추가·삭제는 문서 관리 화면에서 합니다."
      >
        {workspaces.map((ws) => (
          <div key={ws.slug}>
            {workspaces.length > 1 && (
              <p className="text-sm font-semibold text-theme-text-primary mb-1">
                {ws.name}
              </p>
            )}
            <InfoRow label="등록 지침 수">
              {formatNumber(ws.documents?.files)}개 (검색용{" "}
              {formatNumber(ws.documents?.pages)}쪽)
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
            ? `${formatNumber(checklists.total)}개 (공개 ${formatNumber(checklists.active)} · 검토 필요 ${formatNumber(checklists.review)}${checklists.hidden ? ` · 숨김 ${formatNumber(checklists.hidden)}` : ""})`
            : "확인 불가"}
        </InfoRow>
        <Link to="/settings/schat/checklists" className="text-sm text-sky-600 underline">검토하러 가기</Link>
      </Card>
      <details onToggle={event => setDetails(event.currentTarget.open)} className="rounded-xl border border-theme-sidebar-border p-4 text-theme-text-primary">
        <summary className="cursor-pointer font-medium">자세히 보기</summary>
        {details && <div className="mt-4 flex flex-col gap-4">
          <GeminiBudgetPanel />
          <RecentEvents />
          <Card title="AI 설정" help="거의 안 씀. 연결 정보를 바꾸면 직원 답변에 영향을 줄 수 있습니다.">
            <ConnectionsSection onSaved={connectionSaved} />
          </Card>
        </div>}
      </details>
    </div>
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
      help="로그인, 문서 업로드, 설정 변경 같은 최근 기록입니다. 오류가 의심되면 이 기록을 기술 담당자에게 알려 주세요."
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
                  {log.event === "checklist_extraction_issue" &&
                    checklistIssueLabel(log.metadata)}
                  {cleanupLabel(log.event, log.metadata)}
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
