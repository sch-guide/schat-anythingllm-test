import { useEffect, useLayoutEffect, useRef, useState } from "react";
import useSchatBrand from "@/hooks/useSchatBrand";
import {
  announcementActive,
  dismissNotice,
  noticeDismissed,
  noticeScrollSeconds,
  noticeTitle,
  NOTICE_SCROLL_GAP,
} from "@/utils/schatBrand";
import SuggestedMessages from "@/components/lib/SuggestedMessages";

// 공지 띠가 차지하는 높이. 버튼(설정·알림·내 정보)과 대화 화면은 이만큼
// 아래로 내려간다. 공지가 없으면 0이라 화면이 예전과 같다.
const NOTICE_OFFSET_VAR = "--schat-notice-h";
const NOTICE_COLORS = {
  background: "#ecfdf8",
  border: "#bfe8dc",
  title: "#0f766e",
  text: "#134e4a",
};
const SCROLL_KEYFRAMES = `@keyframes schat-notice-scroll{from{transform:translateX(0)}to{transform:translateX(var(--schat-notice-shift))}}`;
const EDGE_FADE =
  "linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 14px), transparent)";

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query)?.matches
  );
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return undefined;
    const update = () => setReduced(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

// Short text stays still. Long text flows right to left (about 50px a second)
// and repeats; hovering or pressing pauses it. With "reduce motion" it is cut
// with … and opens fully on a click.
function NoticeText({ text }) {
  const viewport = useRef(null);
  const measure = useRef(null);
  const [size, setSize] = useState({ text: 0, box: 0 });
  // Paused while a mouse is over it or while it is pressed. Hover comes from
  // a real mouse only: a finger tap also sends mouse-like events, which would
  // otherwise leave it paused after the finger is lifted.
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const paused = hovered || pressed;
  const [expanded, setExpanded] = useState(false);
  const reduced = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const update = () =>
      setSize({
        text: measure.current?.scrollWidth || 0,
        box: viewport.current?.clientWidth || 0,
      });
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [text]);

  const overflows = size.text > size.box + 1;
  const measuring = (
    <span
      ref={measure}
      aria-hidden="true"
      className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap"
    >
      {text}
    </span>
  );

  if (!overflows)
    return (
      <div ref={viewport} className="relative min-w-0 flex-1 overflow-hidden">
        {measuring}
        <span
          className="block whitespace-nowrap"
          data-schat-notice-text="still"
        >
          {text}
        </span>
      </div>
    );

  if (reduced)
    return (
      <div ref={viewport} className="relative min-w-0 flex-1 overflow-hidden">
        {measuring}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={`block w-full border-none bg-transparent p-0 text-left text-inherit ${
            expanded ? "whitespace-normal break-words py-1" : "truncate"
          }`}
          data-schat-notice-text={expanded ? "expanded" : "ellipsis"}
        >
          {text}
        </button>
      </div>
    );

  const shift = size.text + NOTICE_SCROLL_GAP;
  return (
    <div
      ref={viewport}
      className="relative min-w-0 flex-1 overflow-hidden"
      style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setHovered(false);
        setPressed(false);
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
    >
      {measuring}
      <div
        className="inline-flex whitespace-nowrap"
        data-schat-notice-text="scrolling"
        style={{
          "--schat-notice-shift": `-${shift}px`,
          animation: `schat-notice-scroll ${noticeScrollSeconds(size.text)}s linear infinite`,
          animationPlayState: paused ? "paused" : "running",
        }}
      >
        <span style={{ paddingRight: NOTICE_SCROLL_GAP }}>{text}</span>
        <span aria-hidden="true" style={{ paddingRight: NOTICE_SCROLL_GAP }}>
          {text}
        </span>
      </div>
    </div>
  );
}

/** The notice strip itself; also used as the admin preview. */
export function NoticeBar({ title, text, onClose = null }) {
  return (
    <div
      role="status"
      data-schat-notice
      className="flex min-h-[40px] items-center gap-2.5 rounded-xl border px-3 text-sm shadow-sm"
      style={{
        background: NOTICE_COLORS.background,
        borderColor: NOTICE_COLORS.border,
        color: NOTICE_COLORS.text,
      }}
    >
      <style>{SCROLL_KEYFRAMES}</style>
      <span aria-hidden="true" className="shrink-0 text-base leading-none">
        📢
      </span>
      <strong
        className="shrink-0 whitespace-nowrap font-bold"
        style={{ color: NOTICE_COLORS.title }}
      >
        {title}
      </strong>
      <span
        aria-hidden="true"
        className="h-4 w-px shrink-0"
        style={{ background: NOTICE_COLORS.border }}
      />
      <NoticeText text={text} />
      <button
        type="button"
        aria-label="공지 닫기"
        disabled={!onClose}
        onClick={() => onClose?.()}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-none bg-transparent text-sm leading-none hover:bg-[#d1f2e8] disabled:cursor-default"
        style={{ color: NOTICE_COLORS.title }}
      >
        ✕
      </button>
    </div>
  );
}

// Reserves the strip's height for the buttons and the chat (see
// useBrandPanelStyle and the top-right buttons). Follows the strip's real
// height (an opened long notice is taller) and is removed when hidden.
function useNoticeOffset(slot, visible) {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    if (!visible || !slot.current) {
      root.style.removeProperty(NOTICE_OFFSET_VAR);
      return undefined;
    }
    const update = () =>
      root.style.setProperty(
        NOTICE_OFFSET_VAR,
        `${Math.ceil(slot.current?.offsetHeight || 0)}px`
      );
    update();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(slot.current);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(NOTICE_OFFSET_VAR);
    };
  }, [slot, visible]);
}

export function BrandAnnouncement() {
  const { brand, now } = useSchatBrand();
  const notice = brand.announcement;
  const [, setClosed] = useState(0);
  const slot = useRef(null);
  const visible = announcementActive(notice, now) && !noticeDismissed(notice);
  useNoticeOffset(slot, visible);
  if (!visible) return null;
  return (
    <div
      ref={slot}
      className="absolute inset-x-0 top-16 z-30 px-3 pb-1 pt-2 md:top-0 md:px-4"
    >
      <NoticeBar
        title={noticeTitle(notice)}
        text={notice.text}
        onClose={() => {
          dismissNotice(notice);
          setClosed((value) => value + 1);
        }}
      />
    </div>
  );
}

// The chat panel starts below the strip; 0px when there is no notice.
export function useBrandPanelStyle() {
  return { paddingTop: `var(${NOTICE_OFFSET_VAR}, 0px)` };
}
export function BrandWelcome() {
  const { brand } = useSchatBrand();
  return <>{brand.welcome.text}</>;
}
export function BrandExamples({ sendCommand, fallback = [] }) {
  const { brand } = useSchatBrand();
  return (
    <SuggestedMessages
      suggestedMessages={
        brand.welcome.examples.length
          ? brand.welcome.examples.map((message) => ({ heading: "", message }))
          : fallback
      }
      sendCommand={sendCommand}
    />
  );
}
