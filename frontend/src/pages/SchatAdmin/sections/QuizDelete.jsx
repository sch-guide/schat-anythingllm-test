import { useRef, useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import SchatQuiz from "@/models/schatQuiz";
import showToast from "@/utils/toast";
import { Button, Notice, inputClass } from "../ui";

export default function QuizDeleteDialog({
  target,
  onClose,
  onChanged,
  onDeleted,
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = useRef(false);
  async function remove() {
    if (pending.current || confirm !== "삭제") return;
    pending.current = true;
    setBusy(true);
    const result = await SchatQuiz.deleteQuestions(
      target.ids,
      confirm,
      target.filters
    );
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
      `${result.count}개 퀴즈를 삭제했습니다. 직원 풀이 기록은 남아 있습니다.`,
      "success"
    );
    onDeleted?.();
    onClose();
  }
  return (
    <Modal isOpen onClose={busy ? undefined : onClose} size="md">
      <ModalHeader title="퀴즈 삭제" onClose={busy ? undefined : onClose} />
      <ModalBody>
        <p className="text-sm text-theme-text-primary">
          {target.ids.length}개 퀴즈를 지울까요? 직원 풀이 기록은 남아요.
        </p>
        <p className="text-xs text-theme-text-secondary">
          삭제한 문제는 새 퀴즈에 나오지 않으며 다시 공개할 수 없습니다. 확인을
          위해 '삭제'를 정확히 입력해 주세요.
        </p>
        <input
          aria-label="삭제 확인 입력"
          className={inputClass}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="삭제"
          disabled={busy}
        />
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
            disabled={confirm !== "삭제" || busy}
          >
            {busy ? "삭제 중..." : "삭제"}
          </Button>
        </div>
      </ModalBody>
    </Modal>
  );
}
