import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowSquareOut, CaretUp, Minus, X } from "@phosphor-icons/react";
import ChecklistTree from "./ChecklistTree";

const INITIAL_SIZE = { width: 390, height: 520 };
const MIN_SIZE = { width: 310, height: 260 };
const RESIZE_HANDLES = [
  {
    key: "right",
    label: "체크리스트 너비 조절",
    edges: { right: true },
    className: "right-0 top-12 bottom-5 w-2 cursor-ew-resize",
  },
  {
    key: "bottom",
    label: "체크리스트 높이 조절",
    edges: { bottom: true },
    className: "bottom-0 left-0 right-5 h-2 cursor-ns-resize",
  },
  {
    key: "corner",
    label: "체크리스트 크기 조절",
    edges: { right: true, bottom: true },
    className: "bottom-0 right-0 h-5 w-5 cursor-se-resize",
  },
];

export default function ChecklistFloatingPanel({
  checklist,
  isOpen,
  onClose,
  onPopOut,
  onFocus,
  zIndex = 115,
  cascadeIndex = 0,
}) {
  const [minimized, setMinimized] = useState(false);
  const [checkedItems, setCheckedItems] = useState({});
  const [expandedSections, setExpandedSections] = useState({});
  // Each checklist panel owns its own position; later panels open slightly
  // offset so several checklists can be used side by side.
  const [position, setPosition] = useState(() => ({
    x:
      (typeof window === "undefined" ? 454 : window.innerWidth) -
      430 -
      cascadeIndex * 28,
    y: 84 + cascadeIndex * 28,
  }));
  const [size, setSize] = useState(INITIAL_SIZE);
  const [isMobile, setIsMobile] = useState(false);
  const dragState = useRef(null);
  const resizeState = useRef(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (!checklist || !isOpen || typeof document === "undefined") return null;

  const startDrag = (event) => {
    if (isMobile || event.button !== 0) return;
    dragState.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drag = (event) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    setPosition({
      x: event.clientX - dragState.current.offsetX,
      y: event.clientY - dragState.current.offsetY,
    });
  };

  const stopDrag = (event) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const startResize = (event, edges) => {
    if (isMobile || minimized || event.button !== 0) return;
    resizeState.current = {
      edges,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: size.width,
      height: size.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const resize = (event) => {
    const state = resizeState.current;
    if (state?.pointerId !== event.pointerId) return;
    setSize({
      width: state.edges.right
        ? Math.max(MIN_SIZE.width, state.width + event.clientX - state.startX)
        : state.width,
      height: state.edges.bottom
        ? Math.max(MIN_SIZE.height, state.height + event.clientY - state.startY)
        : state.height,
    });
  };

  const stopResize = (event) => {
    if (resizeState.current?.pointerId !== event.pointerId) return;
    resizeState.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const desktopStyle = {
    left: position.x,
    top: position.y,
    width: size.width,
    height: minimized ? "auto" : size.height,
    minWidth: MIN_SIZE.width,
    minHeight: minimized ? undefined : MIN_SIZE.height,
  };
  const mobileStyle = {
    left: 16,
    right: 16,
    bottom: 16,
    width: "auto",
    height: minimized ? "auto" : "min(68vh, 520px)",
  };

  return createPortal(
    <aside
      aria-label={`${checklist.title} 체크리스트 작업창`}
      data-checklist-id={checklist.id}
      onPointerDownCapture={() => onFocus?.(checklist.id)}
      className="fixed flex flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl light:border-slate-300 light:bg-white"
      style={{ ...(isMobile ? mobileStyle : desktopStyle), zIndex }}
    >
      <div
        className="flex min-h-12 shrink-0 touch-none select-none items-center gap-2 border-b border-zinc-700 px-3 light:border-slate-200"
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div className="min-w-0 flex-1 cursor-move">
          <p className="m-0 truncate text-sm font-semibold text-zinc-50 light:text-slate-900">
            {checklist.title} 체크리스트
          </p>
        </div>
        {!isMobile && onPopOut && (
          <button
            type="button"
            aria-label="체크리스트 별도 창으로 열기"
            title="별도 창으로 열기"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onPopOut(checklist.id)}
            className="rounded p-2 text-zinc-300 hover:bg-zinc-800 light:text-slate-600 light:hover:bg-slate-100"
          >
            <ArrowSquareOut size={18} />
          </button>
        )}
        <button
          type="button"
          aria-label={
            minimized ? "체크리스트 다시 펼치기" : "체크리스트 최소화"
          }
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setMinimized((value) => !value)}
          className="rounded p-2 text-zinc-300 hover:bg-zinc-800 light:text-slate-600 light:hover:bg-slate-100"
        >
          {minimized ? <CaretUp size={18} /> : <Minus size={18} />}
        </button>
        <button
          type="button"
          aria-label="체크리스트 닫기"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          className="rounded p-2 text-zinc-300 hover:bg-zinc-800 light:text-slate-600 light:hover:bg-slate-100"
        >
          <X size={18} />
        </button>
      </div>
      <div
        className={`${minimized ? "hidden" : "flex"} min-h-0 flex-1 flex-col`}
      >
        <p className="m-0 shrink-0 px-4 py-2 text-xs text-zinc-400 light:text-slate-600">
          {checklist.source?.filename || ""}
        </p>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-4">
          <ChecklistTree
            checklist={checklist}
            checkedItems={checkedItems}
            onCheckedChange={setCheckedItems}
            expandedSections={expandedSections}
            onToggleSection={(sectionId, expanded) =>
              setExpandedSections((current) => ({
                ...current,
                [sectionId]: !expanded,
              }))
            }
          />
        </div>
        {!isMobile &&
          RESIZE_HANDLES.map(({ key, label, edges, className }) => (
            <div
              key={key}
              role="separator"
              aria-label={label}
              className={`absolute touch-none ${className}`}
              onPointerDown={(event) => startResize(event, edges)}
              onPointerMove={resize}
              onPointerUp={stopResize}
              onPointerCancel={stopResize}
            />
          ))}
      </div>
    </aside>,
    document.getElementById("root")
  );
}
