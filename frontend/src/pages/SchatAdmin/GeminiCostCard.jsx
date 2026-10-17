import { Card, InfoRow } from "./ui";
import { money } from "./aiFeesPresentation";
import { aiStateLabel } from "./SystemOverview";

// 시스템 상태의 Gemini AI 칸. 실제 Gemini 잔액이 아니라 SCHAT에 기록된
// 채팅 사용량으로 계산한 예상 비용만 보여줌.
export function costText(estimate) {
  if (!estimate) return "확인 중";
  if (Number.isFinite(estimate.estimatedKrw))
    return money(estimate.estimatedKrw);
  if (estimate.unknownModels?.length) return "단가 정보 없음";
  if (!estimate.chargedQuestions) return "아직 기록 없음";
  return "계산 불가";
}

export function percentText(budget) {
  if (!budget?.records?.length && !budget?.totalChargedKrw)
    return "충전 기록을 추가하면 표시돼요";
  if (!Number.isFinite(budget?.percent)) return "계산 불가";
  return `약 ${Math.round(budget.percent).toLocaleString("ko-KR")}%`;
}

// 2026-10-17 사용자 요청: "계산에서 뺀 기록 … 단가 모르는 모델 …" 줄은 보이지 않게 함
// (단가 모르는 모델을 빼고 계산한다는 내용은 도움말에 있음).
export default function GeminiCostCard({ ai, aiError, budget }) {
  const month = budget?.month;
  return (
    <Card
      title="Gemini AI"
      help={[
        "기록된 사용량 기준 예상 비용이에요. Google에 남은 실제 잔액이 아니에요.",
        "채팅마다 그때 쓴 모델의 단가로 계산해요. 단가를 모르는 모델은 빼고 계산해요.",
        "문서 등록 때 그림 설명, 퀴즈 생성, 동의어 제안에 쓴 비용은 들어 있지 않아요.",
      ]}
    >
      <div data-testid="gemini-cost-card">
        <InfoRow label="상태">{aiStateLabel(ai, aiError)}</InfoRow>
        <InfoRow label="이번 달 예상 사용요금">{costText(month)}</InfoRow>
        <InfoRow label="충전 금액 대비 예상 사용량">
          {percentText(budget)}
        </InfoRow>
        <p className="mt-2 text-xs text-theme-text-secondary">
          채팅 답변만 계산한 예상치예요. 문서 등록·퀴즈 생성 비용은 빠져 있어
          실제 잔액과 다를 수 있어요.
        </p>
      </div>
    </Card>
  );
}
