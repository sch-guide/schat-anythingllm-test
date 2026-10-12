import { useEffect, useRef, useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import SchatQuiz from "@/models/schatQuiz";
import showToast from "@/utils/toast";
import { Button, Notice, inputClass } from "../ui";

export default function QuizReset({ onReset }) {
  const [lastDate, setLastDate] = useState(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    SchatQuiz.resetPreview().then((r) => {
      if (r.success) setLastDate(r.lastResetAt || null);
    });
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-theme-sidebar-border pt-4">
      <button type="button" data-testid="quiz-reset-open"
        className="rounded-lg border border-red-500 px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10"
        onClick={() => setOpen(true)}>직원 퀴즈 기록 초기화</button>
      <span className="text-xs text-theme-text-secondary" data-testid="quiz-reset-last-date">
        마지막 초기화: {lastDate === undefined ? "확인 중" : lastDate ? new Date(lastDate).toLocaleString("ko-KR") : "아직 없음"}
      </span>
      {open && <QuizResetDialog onClose={() => setOpen(false)} onReset={(result) => {
        setLastDate(result.lastResetAt); onReset?.();
      }} />}
    </div>
  );
}

export function QuizResetDialog({ onClose, onReset }) {
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef(false);
  async function refresh() {
    setConfirm(""); setPreview(null);
    const result = await SchatQuiz.resetPreview();
    if (!result.success) { setError(result.error || "초기화 대상을 불러오지 못했습니다."); return; }
    setPreview(result);
  }
  useEffect(() => { refresh(); }, []);
  async function reset() {
    if (pending.current || confirm !== "초기화" || !preview) return;
    pending.current = true; setBusy(true); setError(null);
    const result = await SchatQuiz.resetRecords(confirm, preview.token);
    if (!result.success) {
      setError(result.error || "초기화하지 못했습니다. 대상을 다시 확인해 주세요.");
      await refresh();
      pending.current = false; setBusy(false);
      return;
    }
    pending.current = false; setBusy(false);
    showToast("직원 퀴즈 기록을 초기화했습니다.", "success");
    onReset?.(result); onClose();
  }
  return (
    <Modal isOpen onClose={busy ? undefined : onClose} size="md">
      <ModalHeader title="직원 퀴즈 기록 초기화" onClose={busy ? undefined : onClose} />
      <ModalBody>
        <div data-testid="quiz-reset-dialog" className="flex flex-col gap-3">
          <p className="text-sm text-theme-text-primary">직원 점수·풀이 기록·오답노트를 모두 지워요. 퀴즈 문제는 그대로 남아요. 되돌릴 수 없어요.</p>
          <p className="text-xs text-theme-text-secondary">단, 이미 삭제한 문제와 이전 문서의 문제도 완전히 지워집니다. 현재 문서의 작성중·공개·사용중지 문제는 남습니다.</p>
          <p className="text-sm text-theme-text-primary">{preview ? `삭제 직원 ${preview.staffCount}명 · 풀이 기록 ${preview.attemptCount}건 · 삭제/이전 문서 문제 ${preview.questionCount}개` : "초기화 대상을 확인하고 있습니다."}</p>
          <label className="text-sm text-theme-text-primary" htmlFor="quiz-reset-confirm">확인을 위해 '초기화'를 정확히 입력해 주세요.</label>
          <input id="quiz-reset-confirm" aria-label="초기화 확인 입력" className={inputClass}
            value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy || !preview} autoComplete="off" />
          {error && <Notice tone="warning"><span role="alert">{error}</span></Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" data-testid="quiz-reset-cancel" onClick={onClose} disabled={busy}>취소</Button>
            <Button variant="danger" data-testid="quiz-reset-execute" onClick={reset}
              disabled={busy || !preview || confirm !== "초기화"}>{busy ? "초기화 중..." : "초기화"}</Button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}
