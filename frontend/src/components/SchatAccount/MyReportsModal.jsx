import { useEffect, useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import SchatAccount from "@/models/schatAccount";

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "-";

export const STATUS_TONES = {
  open: "neutral",
  in_progress: "warning",
  resolved: "ok",
};

// 내 신고: the server only returns reports filed by the signed-in account.
export default function MyReportsModal({ isOpen, onClose }) {
  const [reports, setReports] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setReports(null);
    SchatAccount.myReports().then((r) => setReports(r?.reports || []));
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalHeader title="내 신고" onClose={onClose} />
      <ModalBody>
        {!reports ? (
          <p className="text-sm text-theme-text-secondary">불러오는 중...</p>
        ) : reports.length === 0 ? (
          <p className="text-sm text-theme-text-secondary">
            등록한 신고가 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-y-2">
            {reports.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-theme-sidebar-border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-theme-text-primary">
                    {r.title}
                  </span>
                  <span
                    className={`schat-admin-badge schat-admin-badge--${STATUS_TONES[r.status] || "neutral"} rounded-full px-2.5 py-0.5 text-xs`}
                  >
                    {r.statusLabel}
                  </span>
                </div>
                <p className="text-xs text-theme-text-secondary mt-1">
                  {r.category} · {when(r.createdAt)}
                </p>
                {r.resolution && (
                  <p className="mt-2 whitespace-pre-wrap text-theme-text-primary">
                    <span className="text-xs text-theme-text-secondary block">
                      처리 결과
                    </span>
                    {r.resolution}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </ModalBody>
    </Modal>
  );
}
