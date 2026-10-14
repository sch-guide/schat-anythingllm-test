// 스트리밍 답변을 자연스럽게 이어서 보여 주기 위한 계산.
// Gemini는 문장·문단 단위의 큰 조각을 보내므로, 받은 글자를 한 번에 붙이지 않고
// 다음 몇 프레임(약 0.2초)에 나눠 표시한다. 인위적으로 늦추지 않도록
// 새로 받은 분량은 항상 SMOOTH_DRAIN_MS 안에 모두 표시되고, 답변이 끝나면
// 남은 글자를 바로 모두 보여 준다(훅에서 처리).

export const SMOOTH_DRAIN_MS = 200;
// 남은 글자가 적을 때도 멈춘 것처럼 보이지 않게 하는 최소 속도(글자/ms).
export const MIN_REVEAL_RATE = 0.12;

/** 새 조각을 받았을 때의 표시 속도(글자/ms): 남은 분량을 SMOOTH_DRAIN_MS 안에 표시. */
export function revealRate(remaining = 0) {
  return Math.max(MIN_REVEAL_RATE, Math.max(0, remaining) / SMOOTH_DRAIN_MS);
}

/** 다음 프레임에 보여 줄 글자 수. 이미 받은 글자 수(target)를 넘지 않는다. */
export function nextRevealLength(shown, target, elapsedMs, rate) {
  if (shown >= target) return target;
  const step = Math.max(1, Math.ceil(Math.max(0, elapsedMs) * rate));
  let next = Math.min(target, shown + step);
  return next;
}

/** 이모지 등 두 칸 문자의 중간에서 자르지 않는다. */
export function safeSliceEnd(text = "", end = 0) {
  if (end <= 0 || end >= text.length) return Math.max(0, Math.min(end, text.length));
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end + 1 : end;
}

/**
 * 스트리밍 중 Markdown 표가 깨져 보이지 않게, 아직 줄바꿈이 오지 않은 표 행(|로 시작)은
 * 그 줄이 끝날 때까지 잠시 빼고 보여 준다. 답변이 끝나면 전체를 그대로 표시한다.
 */
export function stableStreamingText(text = "") {
  const lastBreak = text.lastIndexOf("\n");
  const lastLine = text.slice(lastBreak + 1);
  if (lastBreak >= 0 && /^\s*\|/.test(lastLine)) return text.slice(0, lastBreak + 1);
  return text;
}
