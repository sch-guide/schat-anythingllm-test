import { useEffect, useRef, useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import SchatQuiz from "@/models/schatQuiz";
import showToast from "@/utils/toast";
import { Button, Loading, Notice } from "../ui";

// 퀴즈 세트 삭제: 지울 문제·기록 수를 먼저 서버에서 확인해 보여 주고,
// 같은 개수일 때만 지운다. 공개 중인 세트는 서버가 거절한다.
export default function QuizSetDeleteDialog({ set, onClose, onDeleted }) {
  const [counts, setCounts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef(false);

  useEffect(() => {
    let alive = true;
    SchatQuiz.setDeletePreview(set.id).then((r) => {
      if (!alive) return;
      if (r?.success) setCounts(r);
      else setError(r?.error || "지울 문제와 기록 수를 확인하지 못했습니다.");
    });
    return () => {
      alive = false;
    };
  }, [set.id]);

  async function remove() {
    if (pending.current || !counts) return;
    pending.current = true;
    setBusy(true);
    const result = await SchatQuiz.deleteSet(set.id, {
      questions: counts.questions,
      answers: counts.answers,
      wrongNotes: counts.wrongNotes,
      staff: counts.staff,
    });
    pending.current = false;
    setBusy(false);
    if (!result?.success) {
      setError(
        result?.error || "삭제하지 못했습니다. 목록을 다시 확인해 주세요."
      );
      return;
    }
    showToast(`'${set.title}' 세트를 삭제했습니다.`, "success");
    onDeleted?.();
    onClose();
  }

  return (
    <Modal isOpen onClose={busy ? undefined : onClose} size="md">
      <ModalHeader
        title="퀴즈 세트 삭제"
        onClose={busy ? undefined : onClose}
      />
      <ModalBody>
        {!counts && !error && <Loading />}
        {counts && (
          <>
            <p
              className="text-sm font-semibold text-theme-text-primary"
              data-testid="quiz-set-delete-question"
            >
              정말 삭제할까요?
            </p>
            <p
              className="text-sm text-theme-text-primary"
              data-testid="quiz-set-delete-message"
            >
              {`'${set.title}' 세트와 문제 ${counts.questions}개를 지워요. 되돌릴 수 없어요.`}
            </p>
            {counts.staff > 0 && (
              <p
                className="text-sm text-red-500"
                data-testid="quiz-set-delete-records"
              >
                {`직원 ${counts.staff}명의 풀이 기록 ${counts.answers}건도 같이 지워져요.`}
                {counts.wrongNotes > 0 &&
                  ` 오답노트 ${counts.wrongNotes}건도 함께 지워져요.`}
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
            data-testid="quiz-set-delete-confirm"
          >
            {busy ? "삭제 중..." : "삭제"}
          </Button>
        </div>
      </ModalBody>
    </Modal>
  );
}
