import { useEffect, useRef, useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import SchatQuiz from "@/models/schatQuiz";
import showToast from "@/utils/toast";
import { Button, Loading, Notice } from "../ui";

// 진짜 삭제: 문제와 그 문제의 직원 풀이 기록·오답노트를 함께 지운다.
// 지울 개수를 먼저 서버에서 확인해 보여 주고, 같은 개수일 때만 지운다.
export default function QuizDeleteDialog({
  target,
  onClose,
  onChanged,
  onDeleted,
}) {
  const [counts, setCounts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef(false);

  useEffect(() => {
    let alive = true;
    SchatQuiz.deletePreview(target.ids, target.filters).then((r) => {
      if (!alive) return;
      if (r?.success) setCounts(r);
      else setError(r?.error || "지울 기록 수를 확인하지 못했습니다.");
    });
    return () => {
      alive = false;
    };
  }, [target]);

  async function remove() {
    if (pending.current || !counts) return;
    pending.current = true;
    setBusy(true);
    const result = await SchatQuiz.deleteQuestions(target.ids, target.filters, {
      answers: counts.answers,
      wrongNotes: counts.wrongNotes,
    });
    pending.current = false;
    setBusy(false);
    onChanged?.();
    if (!result.success) {
      setError(
        result.error || "삭제하지 못했습니다. 목록을 다시 확인해 주세요."
      );
      return;
    }
    showToast(
      `퀴즈 ${result.questions}개와 직원 풀이 기록 ${result.answers}건을 지웠습니다.`,
      "success"
    );
    onDeleted?.();
    onClose();
  }

  const single = target.ids.length === 1;
  return (
    <Modal isOpen onClose={busy ? undefined : onClose} size="md">
      <ModalHeader title="퀴즈 삭제" onClose={busy ? undefined : onClose} />
      <ModalBody>
        {!counts && !error && <Loading />}
        {counts && (
          <>
            <p
              className="text-sm text-theme-text-primary"
              data-testid="quiz-delete-message"
            >
              {single
                ? `이 문제와 직원 풀이 기록 ${counts.answers}건을 지워요. 되돌릴 수 없어요.`
                : `문제 ${counts.questions}개와 직원 풀이 기록 ${counts.answers}건을 지워요. 되돌릴 수 없어요.`}
            </p>
            {counts.wrongNotes > 0 && (
              <p className="text-xs text-theme-text-secondary">
                직원 오답노트 {counts.wrongNotes}건도 함께 지워져요.
              </p>
            )}
            <p className="text-xs text-theme-text-secondary">
              퀴즈가 아닌 자료(대화 기록, 문서, 동의어, 계정 등)는 그대로예요.
            </p>
          </>
        )}
        {error && (
          <Notice tone="warning">
            <span role="alert">{error}</span>
          </Notice>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button
            variant="danger"
            onClick={remove}
            disabled={!counts || busy}
            data-testid="quiz-delete-confirm"
          >
            {busy ? "삭제 중..." : "삭제"}
          </Button>
        </div>
      </ModalBody>
    </Modal>
  );
}
