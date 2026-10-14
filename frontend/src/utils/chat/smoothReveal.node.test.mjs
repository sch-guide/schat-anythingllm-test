import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MIN_REVEAL_RATE,
  SMOOTH_DRAIN_MS,
  nextRevealLength,
  revealRate,
  safeSliceEnd,
  stableStreamingText,
} from "./smoothReveal.js";

function framesToShow(shown, target, frameMs = 16) {
  const rate = revealRate(target - shown);
  let frames = 0;
  while (shown < target) {
    const next = nextRevealLength(shown, target, frameMs, rate);
    assert.ok(next > shown, "매 프레임 글자가 늘어나야 함");
    assert.ok(next <= target, "받지 않은 글자를 보여 주면 안 됨");
    shown = next;
    frames += 1;
  }
  return frames;
}

test("큰 조각도 약 0.2초 안에 모두 표시되어 실제 출력이 늦어지지 않음", () => {
  for (const size of [1, 20, 300, 2000]) {
    const frames = framesToShow(0, size);
    assert.ok(frames * 16 <= SMOOTH_DRAIN_MS + 16, `${size}자: ${frames}프레임`);
  }
});

test("한 조각을 여러 프레임에 나눠 이어서 보여 줌(한 번에 툭 나타나지 않음)", () => {
  assert.ok(framesToShow(0, 300) >= 8);
});

test("남은 글자가 적어도 최소 속도로 계속 진행됨", () => {
  assert.equal(revealRate(0), MIN_REVEAL_RATE);
  assert.equal(nextRevealLength(5, 5, 16, revealRate(0)), 5);
  assert.equal(nextRevealLength(4, 5, 16, revealRate(1)), 5);
});

test("표 행은 줄이 끝날 때까지 기다려 깨진 표가 잠깐 보이지 않음", () => {
  assert.equal(stableStreamingText("설명\n| 항목 | 값"), "설명\n");
  assert.equal(stableStreamingText("설명\n| 항목 | 값 |\n"), "설명\n| 항목 | 값 |\n");
  assert.equal(stableStreamingText("일반 문장 진행 중"), "일반 문장 진행 중");
});

test("이모지 등 두 칸 문자를 반으로 자르지 않음", () => {
  const text = "가😀나";
  assert.equal(safeSliceEnd(text, 2), 3);
  assert.equal(safeSliceEnd(text, 1), 1);
});

test("채팅 답변은 스트리밍 중에만 이어서 표시하고 완료되면 전체를 즉시 표시함", () => {
  const hook = readFileSync(new URL("../../hooks/useSmoothText.js", import.meta.url), "utf8");
  assert.match(hook, /if \(!active\) return target;/);
  assert.doesNotMatch(hook, /setTimeout/);
  const message = readFileSync(
    new URL("../../components/WorkspaceChat/ChatContainer/ChatHistory/HistoricalMessage/index.jsx", import.meta.url),
    "utf8"
  );
  assert.match(message, /useSmoothText\(\s*message \|\| "",\s*role === "assistant" && streaming\s*\)/);
  assert.match(message, /prevProps\.isStreaming === nextProps\.isStreaming/);
  const history = readFileSync(
    new URL("../../components/WorkspaceChat/ChatContainer/ChatHistory/index.jsx", import.meta.url),
    "utf8"
  );
  assert.match(history, /const isStreamingReply = isLastBotReply && runIsLive;/);
  assert.match(history, /useAutoScroll\(history, ref, runIsLive\)/);
});
