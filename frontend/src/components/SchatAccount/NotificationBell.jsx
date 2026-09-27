import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "@phosphor-icons/react";
import SchatAccount from "@/models/schatAccount";

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";

export const NOTIFICATION_REFRESH_EVENT = "schat-notifications-refresh";

// Only the signed-in user's own notifications (server filters by user id).
export default function NotificationBell() {
  const [data, setData] = useState({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    const result = await SchatAccount.notifications();
    if (result?.ok)
      setData({ unread: result.unread || 0, items: result.items || [] });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener(NOTIFICATION_REFRESH_EVENT, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATION_REFRESH_EVENT, load);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && data.unread > 0) {
      await SchatAccount.markRead();
      setData((prev) => ({
        unread: 0,
        items: prev.items.map((i) => ({
          ...i,
          read: true,
          wasUnread: !i.read,
        })),
      }));
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={`알림${data.unread ? ` ${data.unread}개 읽지 않음` : ""}`}
        className="relative transition-all duration-300 w-[35px] h-[35px] rounded-full flex items-center justify-center bg-theme-action-menu-bg hover:bg-theme-action-menu-item-hover text-white border border-transparent"
      >
        <Bell size={20} aria-hidden="true" />
        {data.unread > 0 && (
          <span
            data-testid="notification-count"
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[11px] leading-[18px] text-center"
          >
            {data.unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="알림"
          className="schat-popover absolute top-12 right-0 w-[300px] max-h-[380px] overflow-y-auto rounded-lg bg-theme-action-menu-bg p-2 shadow-lg"
        >
          <p className="px-2 py-1 text-sm font-semibold text-theme-text-primary">
            알림
          </p>
          {data.items.length === 0 ? (
            <p className="px-2 py-3 text-sm text-theme-text-secondary">
              새 알림이 없습니다.
            </p>
          ) : (
            data.items.map((item) => (
              <div
                key={item.id}
                className={`rounded-md px-2 py-2 text-sm ${item.wasUnread ? "bg-sky-500/10" : ""}`}
              >
                <p className="text-theme-text-primary">{item.message}</p>
                {item.report && (
                  <>
                    <p className="text-xs text-theme-text-secondary mt-0.5">
                      {item.report.title} · {item.report.statusLabel}
                    </p>
                    {item.report.resolution && (
                      <p className="text-xs text-theme-text-primary mt-1 whitespace-pre-wrap">
                        처리 결과: {item.report.resolution}
                      </p>
                    )}
                  </>
                )}
                <p className="text-[11px] text-theme-text-secondary mt-0.5">
                  {when(item.report?.resolvedAt || item.createdAt)}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
