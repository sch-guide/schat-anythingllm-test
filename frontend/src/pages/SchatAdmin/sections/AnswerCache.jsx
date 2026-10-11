import { useEffect, useMemo, useSyncExternalStore } from "react";
import AnswerCache from "@/models/answerCache";
import { createAnswerCacheController } from "../answerCacheController";
import { Button, Card, InfoRow, Notice } from "../ui";

export default function AnswerCacheSection({ workspace, slug }) {
  // The workspace fetch may still refer to the previous picker selection.
  if (!workspace || workspace.slug !== slug)
    return (
      <Notice>
        관리할 작업 공간을 선택하거나 작업 공간 정보가 표시될 때까지 기다려
        주세요.
      </Notice>
    );
  return <WorkspaceAnswerCache key={workspace.id} workspace={workspace} />;
}

function WorkspaceAnswerCache({ workspace }) {
  const controller = useMemo(
    () => createAnswerCacheController(AnswerCache, workspace.id),
    [workspace.id],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  return (
    <AnswerCacheView
      controller={controller}
      state={state}
      workspace={workspace}
    />
  );
}

export function AnswerCacheView({ controller, state, workspace }) {
  const { data, loading, busy, error, notice } = state;
  const disabled = busy || loading;
  function clearAll() {
    if (disabled || !data) return;
    if (
      window.confirm(
        "모든 작업 공간의 답변 저장본을 비우시겠습니까? 문서·대화 기록은 지우지 않습니다. 다음 질문에서는 답변을 새로 만듭니다.",
      )
    )
      return controller.clear(true);
  }
  return (
    <div className="flex flex-col gap-y-5">
      <Notice>
        안전한 독립 질문만 재사용합니다. 같은 작업 공간의 문서에 근거한 질문 중
        이전 대화·첨부가 없고 AI 자동 작업(Agent)이 아닌 경우에만 적용합니다.
        저장본은 전체 작업 공간을 합쳐 최대 100개이며 서버를 재시작하면
        비워집니다.
      </Notice>
      {notice && (
        <div role="status">
          <Notice>{notice}</Notice>
        </div>
      )}
      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}
      <Card
        title="재사용 현황"
        description="절약 횟수는 캐시로 일반 답변 호출을 최소 1회 아낀 횟수입니다. 문서 검색용 AI 변환(embedding)이나 AI 자동 작업(Agent)의 전체 비용 절약을 뜻하지 않습니다."
      >
        {loading && (
          <p role="status" className="text-sm text-theme-text-secondary">
            현황을 불러오는 중...
          </p>
        )}
        {data && !loading && (
          <div>
            <InfoRow label="선택 작업 공간">{workspace.name}</InfoRow>
            <InfoRow label="선택 작업 공간의 저장 질문">
              {data.entries.length.toLocaleString("ko-KR")}개
            </InfoRow>
            <InfoRow label="전체 작업 공간의 저장 질문">
              {data.stats.entries.toLocaleString("ko-KR")} / 100개
            </InfoRow>
            <InfoRow label="서버 시작 후 전체 작업 공간에서 아낀 답변 호출">
              {data.stats.savedAnswerCalls.toLocaleString("ko-KR")}회 이상
            </InfoRow>
            <p className="mt-2 text-xs text-theme-text-secondary">
              누계는 선택 작업 공간만의 수치가 아닙니다. 저장본을 삭제해도
              누계는 유지되며 서버 재시작 시 초기화됩니다.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => controller.load()}
          >
            새로 고침
          </Button>
          <Button
            variant="danger"
            disabled={disabled || !data || data.stats.entries === 0}
            onClick={clearAll}
          >
            {busy ? "처리 중..." : "모든 작업 공간의 저장본 비우기"}
          </Button>
        </div>
      </Card>
      {data && !loading && (
        <Card
          title="선택 작업 공간의 저장 질문"
          description="삭제와 전체 비우기는 답변 캐시만 지웁니다. 문서·대화 기록은 지우지 않습니다."
        >
          {data.entries.length === 0 ? (
            <p className="text-sm text-theme-text-secondary">
              저장된 질문이 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm text-left text-theme-text-primary">
                <thead className="text-xs text-theme-text-secondary border-b border-theme-sidebar-border">
                  <tr>
                    {[
                      "질문",
                      "작업 공간",
                      "사용 횟수",
                      "저장 시각",
                      "관리",
                    ].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className="py-2 pr-3 font-medium"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-theme-sidebar-border align-top"
                    >
                      <td className="py-3 pr-3 max-w-[380px] whitespace-pre-wrap break-words">
                        {entry.question}
                      </td>
                      <td className="py-3 pr-3">{workspace.name}</td>
                      <td className="py-3 pr-3 whitespace-nowrap">
                        {entry.uses.toLocaleString("ko-KR")}회
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString("ko-KR")}
                      </td>
                      <td className="py-3">
                        <Button
                          variant="secondary"
                          disabled={disabled}
                          aria-label={`${entry.question} 저장본 삭제`}
                          onClick={() => controller.remove(entry.id)}
                        >
                          삭제
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
