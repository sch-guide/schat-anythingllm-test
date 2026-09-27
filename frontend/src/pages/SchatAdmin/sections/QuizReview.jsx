import { useEffect, useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import SchatQuiz from "@/models/schatQuiz";
import showToast from "@/utils/toast";
import { SourceEvidenceRow } from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Citation";
import { Badge, Button, Field, Loading, Notice, inputClass } from "../ui";
import { DIFFICULTIES, STATUS_TONE } from "./quizLabels";

const LETTERS = ["A", "B", "C", "D"];

function toForm(q) {
  return {
    question: q.question,
    choices: q.choices.map((c) => c.text),
    correctChoiceId: q.correctChoiceId || "",
    correctOx: q.correctOx || "",
    explanation: q.explanation,
    topic: q.topic,
    difficulty: q.difficulty,
    sourcePage: String(q.sourcePage),
  };
}

// 문제 검토: edit, 원문 확인 (existing PDF viewer), 공개/사용중지, 다시 생성
// (the only AI call here) and 완전삭제.
export default function QuizReviewDialog({ id, onClose, onChanged }) {
  const [q, setQ] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    SchatQuiz.question(id).then((r) => {
      if (!r.success) return setError(r.error);
      setQ(r.question);
      setForm(toForm(r.question));
    });
  }, [id]);

  const set = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const setChoice = (i) => (e) =>
    setForm((prev) => {
      const choices = [...prev.choices];
      choices[i] = e.target.value;
      return { ...prev, choices };
    });

  async function run(label, fn, message) {
    setBusy(label);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.success) {
      setError(r.error || "처리하지 못했습니다.");
      return null;
    }
    if (message) showToast(message, "success");
    onChanged?.();
    return r;
  }

  async function save() {
    const r = await run(
      "save",
      () =>
        SchatQuiz.updateQuestion(id, {
          ...form,
          sourcePage: Number(form.sourcePage),
        }),
      "문제를 저장했습니다."
    );
    if (r) {
      setQ(r.question);
      setForm(toForm(r.question));
    }
  }

  async function status(next, message) {
    const r = await run(
      "status",
      () => SchatQuiz.setStatus([id], next),
      message
    );
    if (r) {
      const fresh = await SchatQuiz.question(id);
      if (fresh.success) setQ(fresh.question);
    }
  }

  async function regenerate() {
    const r = await run(
      "regen",
      () => SchatQuiz.regenerate(id),
      "새 문제로 다시 만들었습니다. 검토 후 공개해 주세요."
    );
    if (r) {
      setQ(r.question);
      setForm(toForm(r.question));
      setShowSource(false);
    }
  }

  async function remove() {
    const r = await run(
      "delete",
      () => SchatQuiz.deleteQuestions([id], confirmDelete),
      "문제를 삭제했습니다."
    );
    if (r) onClose();
  }

  const dirty = q && form && JSON.stringify(toForm(q)) !== JSON.stringify(form);
  return (
    <Modal isOpen onClose={onClose} size="xl">
      <ModalHeader
        title={q ? `문제 검토 #${q.id}` : "문제 검토"}
        onClose={onClose}
      />
      <ModalBody>
        {!q || !form ? (
          error ? (
            <Notice tone="warning">{error}</Notice>
          ) : (
            <Loading />
          )
        ) : (
          <div className="flex flex-col gap-y-4" data-testid="quiz-review">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[q.status]}>{q.statusLabel}</Badge>
              <Badge tone="neutral">{q.questionTypeLabel}</Badge>
              {q.outdated && (
                <Badge tone="warning">이전 문서 기반 · 직원 출제 제외</Badge>
              )}
              <span className="text-xs text-theme-text-secondary">
                {q.documentName}
                {q.documentVersion ? ` (버전 ${q.documentVersion})` : ""} ·{" "}
                {q.quizSetTitle || "세트 없음"}
              </span>
            </div>
            {q.reviewNote && (
              <Notice tone="warning">자동 확인: {q.reviewNote}</Notice>
            )}

            <Field label="문제" htmlFor="qr-question">
              <textarea
                id="qr-question"
                rows={2}
                className={`${inputClass} resize-y`}
                value={form.question}
                onChange={set("question")}
              />
            </Field>

            {q.questionType === "multiple_choice" ? (
              <fieldset className="flex flex-col gap-y-2">
                <legend className="text-sm font-medium text-theme-text-primary mb-1">
                  선택지와 정답
                </legend>
                {form.choices.map((text, i) => {
                  const choiceId = `c${i + 1}`;
                  return (
                    <label key={choiceId} className="flex items-center gap-x-2">
                      <input
                        type="radio"
                        name="qr-correct"
                        aria-label={`${LETTERS[i]} 정답`}
                        className="h-4 w-4 accent-emerald-600"
                        checked={form.correctChoiceId === choiceId}
                        onChange={() =>
                          setForm((p) => ({ ...p, correctChoiceId: choiceId }))
                        }
                      />
                      <span className="w-5 text-sm font-semibold text-theme-text-primary">
                        {LETTERS[i]}
                      </span>
                      <input
                        aria-label={`선택지 ${LETTERS[i]}`}
                        className={inputClass}
                        value={text}
                        onChange={setChoice(i)}
                      />
                    </label>
                  );
                })}
                <p className="text-xs text-theme-text-secondary">
                  왼쪽 동그라미가 정답입니다. 직원 화면에서는 선택지 순서가 섞여
                  나오지만 정답은 선택지 내용 기준으로 판정합니다.
                </p>
              </fieldset>
            ) : (
              <Field label="정답" htmlFor="qr-ox">
                <div className="flex gap-4" id="qr-ox">
                  {["O", "X"].map((v) => (
                    <label
                      key={v}
                      className="inline-flex items-center gap-x-2 text-sm text-theme-text-primary"
                    >
                      <input
                        type="radio"
                        name="qr-ox"
                        className="h-4 w-4 accent-emerald-600"
                        checked={form.correctOx === v}
                        onChange={() =>
                          setForm((p) => ({ ...p, correctOx: v }))
                        }
                      />
                      {v}
                    </label>
                  ))}
                </div>
              </Field>
            )}

            <Field label="해설" htmlFor="qr-explanation">
              <textarea
                id="qr-explanation"
                rows={3}
                className={`${inputClass} resize-y`}
                value={form.explanation}
                onChange={set("explanation")}
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="주제" htmlFor="qr-topic">
                <input
                  id="qr-topic"
                  className={inputClass}
                  value={form.topic}
                  onChange={set("topic")}
                />
              </Field>
              <Field label="난이도" htmlFor="qr-difficulty">
                <select
                  id="qr-difficulty"
                  className={inputClass}
                  value={form.difficulty}
                  onChange={set("difficulty")}
                >
                  {DIFFICULTIES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="출처 쪽"
                htmlFor="qr-page"
                help="저장할 때 문서에 실제 있는 쪽인지 확인합니다."
              >
                <input
                  id="qr-page"
                  type="number"
                  min={1}
                  className={inputClass}
                  value={form.sourcePage}
                  onChange={set("sourcePage")}
                />
              </Field>
            </div>

            <div className="rounded-lg border border-theme-sidebar-border px-4 py-3 flex flex-col gap-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-theme-text-primary">
                  출처: {q.documentName} · p.{q.sourcePage}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => setShowSource((v) => !v)}
                  disabled={q.outdated}
                >
                  {showSource ? "원문 닫기" : "원문 확인"}
                </Button>
              </div>
              {q.sourceExcerpt && (
                <p className="text-xs text-theme-text-secondary whitespace-pre-wrap">
                  근거 문장: {q.sourceExcerpt}
                </p>
              )}
              {showSource && (
                <div data-testid="quiz-review-source">
                  <SourceEvidenceRow
                    key={`${q.sourcePage}-${q.updatedAt}`}
                    source={{
                      documentName: q.source.documentName,
                      page: q.source.page,
                      pdfRef: q.source.pdfRef,
                      excerpt: q.source.excerpt,
                    }}
                    index={0}
                    workspaceSlug={q.source.workspaceSlug}
                    initiallyOpen
                  />
                </div>
              )}
            </div>

            {error && (
              <Notice tone="warning">
                <span role="alert">{error}</span>
              </Notice>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={!dirty || !!busy}>
                {busy === "save" ? "저장 중..." : "저장"}
              </Button>
              {q.status !== "approved" ? (
                <Button
                  onClick={() =>
                    status(
                      "approved",
                      "공개했습니다. 이제 직원 퀴즈에 나옵니다."
                    )
                  }
                  disabled={dirty || !!busy || q.outdated}
                >
                  공개
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => status("inactive", "사용중지했습니다.")}
                  disabled={!!busy}
                >
                  사용중지
                </Button>
              )}
              {q.status === "draft" && (
                <Button
                  variant="secondary"
                  onClick={() => status("inactive", "사용중지했습니다.")}
                  disabled={!!busy}
                >
                  사용중지
                </Button>
              )}
              {q.status !== "approved" && !q.outdated && (
                <Button
                  variant="secondary"
                  onClick={regenerate}
                  disabled={!!busy}
                >
                  {busy === "regen" ? "다시 만드는 중..." : "AI로 다시 생성"}
                </Button>
              )}
            </div>
            {dirty && (
              <p className="text-xs text-theme-text-secondary">
                수정한 내용을 저장한 뒤 공개할 수 있습니다.
              </p>
            )}

            <section
              className="flex flex-col gap-y-2 border-t border-theme-sidebar-border pt-3"
              data-testid="quiz-review-danger"
            >
              <p className="text-sm font-semibold text-red-500">위험 영역</p>
              <p className="text-xs text-theme-text-secondary">
                완전삭제하면 이 문제와 직원의 풀이·오답 기록도 함께 지워집니다.
                보통은 사용중지를 권장합니다. 확인을 위해 '삭제'를 입력하세요.
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  aria-label="삭제 확인 입력"
                  className={`${inputClass} !w-40`}
                  value={confirmDelete}
                  onChange={(e) => setConfirmDelete(e.target.value)}
                  placeholder="삭제"
                />
                <Button
                  variant="danger"
                  onClick={remove}
                  disabled={confirmDelete.trim() !== "삭제" || !!busy}
                >
                  완전삭제
                </Button>
              </div>
            </section>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}
