import { useEffect, useRef, useState } from "react";
import {
  nextRevealLength,
  revealRate,
  safeSliceEnd,
  stableStreamingText,
} from "@/utils/chat/smoothReveal";

function prefersReducedMotion() {
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  } catch {
    return false;
  }
}

/**
 * 스트리밍 중인 답변 글자를 프레임마다 조금씩 이어서 보여 준다.
 * - active가 false(답변 완료·과거 기록)이면 전체 글자를 바로 돌려준다.
 * - 이 훅을 쓰는 컴포넌트만 다시 그려지므로 대화 전체가 깜빡이지 않는다.
 */
export default function useSmoothText(text = "", active = false) {
  const target = typeof text === "string" ? text : "";
  const [length, setLength] = useState(() => (active ? 0 : target.length));
  const lengthRef = useRef(length);
  const rateRef = useRef(revealRate(target.length));
  lengthRef.current = length;

  useEffect(() => {
    if (!active || prefersReducedMotion()) {
      if (lengthRef.current !== target.length) setLength(target.length);
      return undefined;
    }
    // 새 조각을 받으면 남은 분량을 짧은 시간 안에 모두 보이도록 속도를 다시 정한다.
    const shown = Math.min(lengthRef.current, target.length);
    rateRef.current = revealRate(target.length - shown);
    if (shown >= target.length) return undefined;
    let frame = 0;
    let last = null;
    const tick = (time) => {
      const elapsed = last === null ? 16 : time - last;
      last = time;
      const next = nextRevealLength(
        Math.min(lengthRef.current, target.length),
        target.length,
        elapsed,
        rateRef.current
      );
      lengthRef.current = next;
      setLength(next);
      if (next < target.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active]);

  if (!active) return target;
  const end = safeSliceEnd(target, Math.min(length, target.length));
  return stableStreamingText(target.slice(0, end));
}
