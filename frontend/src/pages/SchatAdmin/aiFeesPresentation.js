const n = (value) => value.toLocaleString("ko-KR");
export function money(value) {
  if (!Number.isFinite(value)) return "계산 불가";
  if (value > 0 && value < 50) return "약 100원 미만";
  return `약 ${n(Math.round(value / 100) * 100)}원`;
}
export const questions = (value) =>
  Number.isFinite(value)
    ? value > 0 && value < 5
      ? "약 10번 미만"
      : `약 ${n(Math.round(value / 10) * 10)}번`
    : "아직 계산 중이에요";
export const days = (value) =>
  Number.isFinite(value)
    ? value > 0 && value < 0.5
      ? "약 1일 미만"
      : `약 ${n(Math.round(value))}일`
    : "아직 계산 중이에요";
export function feeWarning(budget) {
  if (!Number.isFinite(budget?.remainingKrw)) return "";
  const forecast = Number.isFinite(budget.questionsRemaining)
    ? `${questions(budget.questionsRemaining)} 더 질문 가능`
    : "아직 계산 중이에요";
  return `남은 돈 ${money(budget.remainingKrw)} · ${forecast} · 충전해 주세요`;
}
