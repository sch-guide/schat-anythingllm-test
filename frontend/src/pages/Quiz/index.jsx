import { useEffect, useMemo, useState } from "react";
import { isMobile } from "react-device-detect";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import QuizIcon from "@/components/SchatQuiz/QuizIcon";
import SchatQuiz from "@/models/schatQuiz";
import { SourceEvidenceRow } from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Citation";

// 지침서 퀴즈 (staff). Everything here reads questions the admin already
// reviewed and published; starting, answering and reviewing never create new
// questions and never call an AI service.
export default function QuizPage() {
  return (
    <div className="schat-app-bg w-screen h-screen overflow-hidden bg-zinc-950 light:bg-slate-50 flex">
      {!isMobile ? <Sidebar /> : <SidebarMobileHeader />}
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="schat-chat-panel relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-zinc-900 light:bg-white w-full h-full overflow-y-auto border-none light:border-solid light:border light:border-theme-modal-border"
      >
        <Quiz />
      </div>
    </div>
  );
}

export const card =
  "schat-quiz-card rounded-2xl border border-zinc-700 bg-zinc-900 light:border-slate-200 light:bg-white light:shadow-sm";
const muted = "text-zinc-400 light:text-slate-500";
const strong = "text-white light:text-slate-900";
const select =
  "w-full h-[42px] rounded-xl px-3 text-sm outline-none bg-zinc-800 light:bg-slate-50 text-white light:text-slate-900 border border-zinc-700 light:border-slate-300 focus:border-sky-500";
export const primaryBtn =
  "rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold !text-white hover:bg-sky-500 disabled:opacity-40";
export const secondaryBtn =
  "rounded-xl border border-zinc-600 px-4 py-2.5 text-sm font-medium text-zinc-100 hover:border-sky-500 disabled:opacity-40 light:border-slate-300 light:text-slate-700";

const TABS = [
  ["play", "퀴즈 풀기"],
  ["notes", "오답노트"],
  ["history", "최근 기록"],
];

function Quiz() {
  const [tab, setTab] = useState("play");
  const [run, setRun] = useState(null); // { attemptId, notice, request }
  const [error, setError] = useState(null);

  // request: { kind: "normal", filters } | { kind: "wrong", count }
  async function begin(request) {
    setError(null);
    const result =
      request.kind === "wrong"
        ? await SchatQuiz.startWrongReview(request.count)
        : await SchatQuiz.start(request.filters);
    if (!result.success) {
      setError(result.error);
      return false;
    }
    setTab("play");
    setRun({ attemptId: result.attemptId, notice: result.notice, request });
    return true;
  }

  return (
    <div className="schat-quiz mx-auto w-full max-w-[1080px] px-4 md:px-8 pt-16 md:pt-10 pb-16 flex flex-col gap-y-5">
      <header className="flex items-start gap-x-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 light:bg-sky-50 light:text-sky-700">
          <QuizIcon size={26} />
        </span>
        <div>
          <h1 className={`text-xl font-bold ${strong}`}>지침서 기반 퀴즈</h1>
          <p className={`text-sm ${muted}`}>
            병원 지침서를 바탕으로 만든 문제로 실무 지식을 확인해보세요.
          </p>
        </div>
      </header>

      {!run && (
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="퀴즈 메뉴"
        >
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                setError(null);
                setTab(key);
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium border transition-colors ${
                tab === key
                  ? "bg-sky-600 border-sky-600 !text-white"
                  : "border-zinc-700 text-zinc-300 hover:border-sky-500 light:border-slate-300 light:text-slate-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400 light:text-red-600">
          {error}
        </p>
      )}

      {run ? (
        <QuizRun
          key={run.attemptId}
          attemptId={run.attemptId}
          notice={run.notice}
          onRetry={() => begin(run.request)}
          onWrongReview={() => begin({ kind: "wrong", count: 10 })}
          onExit={() => setRun(null)}
        />
      ) : tab === "play" ? (
        <QuizSetup onStart={(filters) => begin({ kind: "normal", filters })} />
      ) : tab === "notes" ? (
        <WrongNotes onReview={() => begin({ kind: "wrong", count: 10 })} />
      ) : (
        <History />
      )}
    </div>
  );
}

// ---- setup: filters over stored, published questions ---------------------------

function QuizSetup({ onStart }) {
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState({
    docKey: "",
    topic: "",
    count: "10",
    difficulty: "",
    questionType: "",
  });
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    SchatQuiz.options().then((r) => setOptions(r?.ok ? r : { error: true }));
  }, []);

  const topics = useMemo(() => {
    if (!options?.documents) return [];
    const docs = form.docKey
      ? options.documents.filter((d) => d.docKey === form.docKey)
      : options.documents;
    return [...new Set(docs.flatMap((d) => d.topics.map((t) => t.topic)))];
  }, [options, form.docKey]);

  const available = useMemo(
    () =>
      (options?.pool || []).filter(
        (q) =>
          (!form.docKey || q.docKey === form.docKey) &&
          (!form.topic || q.topic === form.topic) &&
          (!form.difficulty || q.difficulty === form.difficulty) &&
          (!form.questionType || q.questionType === form.questionType)
      ).length,
    [options, form]
  );

  const set = (key) => (e) =>
    setForm((prev) => ({
      ...prev,
      [key]: e.target.value,
      ...(key === "docKey" ? { topic: "" } : {}),
    }));

  async function start() {
    setStarting(true);
    await onStart(form);
    setStarting(false);
  }

  if (!options) return <p className={`text-sm ${muted}`}>불러오는 중...</p>;
  if (options.error)
    return (
      <p className={`text-sm ${muted}`}>퀴즈 정보를 불러오지 못했습니다.</p>
    );
  if (options.total === 0)
    return (
      <p
        className={`rounded-xl border border-dashed border-zinc-700 light:border-slate-300 px-4 py-8 text-center text-sm ${muted}`}
      >
        아직 공개된 퀴즈가 없습니다. 관리자가 문제를 공개하면 여기에서 풀 수
        있습니다.
      </p>
    );

  return (
    <section className={`${card} p-5 md:p-6 flex flex-col gap-y-4`}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Labeled label="대상 문서" id="quiz-doc">
          <select
            id="quiz-doc"
            className={select}
            value={form.docKey}
            onChange={set("docKey")}
          >
            <option value="">전체 문서</option>
            {options.documents.map((d) => (
              <option key={d.docKey} value={d.docKey}>
                {d.name}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="주제" id="quiz-topic">
          <select
            id="quiz-topic"
            className={select}
            value={form.topic}
            onChange={set("topic")}
          >
            <option value="">전체 주제</option>
            {topics.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="문항 수" id="quiz-count">
          <select
            id="quiz-count"
            className={select}
            value={form.count}
            onChange={set("count")}
          >
            {[5, 10, 15, 20].map((n) => (
              <option key={n} value={String(n)}>
                {n}문항
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="난이도" id="quiz-difficulty">
          <select
            id="quiz-difficulty"
            className={select}
            value={form.difficulty}
            onChange={set("difficulty")}
          >
            <option value="">전체</option>
            {options.difficulties.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="문제 유형" id="quiz-type">
          <select
            id="quiz-type"
            className={select}
            value={form.questionType}
            onChange={set("questionType")}
          >
            <option value="">전체</option>
            {options.questionTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Labeled>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={`text-sm ${muted}`} data-testid="quiz-available">
          선택한 조건의 공개 문제 {available}개
          {available > 0 && available < Number(form.count)
            ? ` · 현재 ${available}문항이 준비되어 있습니다.`
            : ""}
        </p>
        <button
          type="button"
          className={primaryBtn}
          disabled={starting || available === 0}
          onClick={start}
        >
          {starting ? "준비 중..." : "퀴즈 시작"}
        </button>
      </div>
    </section>
  );
}

function Labeled({ label, id, children }) {
  return (
    <div className="flex flex-col gap-y-1.5">
      <label htmlFor={id} className={`text-xs font-medium ${muted}`}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ---- running a quiz --------------------------------------------------------------

function QuizRun({ attemptId, notice, onRetry, onWrongReview, onExit }) {
  const [attempt, setAttempt] = useState(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState({});
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    SchatQuiz.attempt(attemptId).then((r) => {
      if (!r.success) return setError(r.error);
      setAttempt(r.attempt);
      const firstOpen = r.attempt.questions.findIndex((q) => !q.answer);
      setIndex(firstOpen === -1 ? 0 : firstOpen);
    });
  }, [attemptId]);

  if (error)
    return (
      <p role="alert" className="text-sm text-red-400 light:text-red-600">
        {error}
      </p>
    );
  if (!attempt) return <p className={`text-sm ${muted}`}>불러오는 중...</p>;

  const questions = attempt.questions;
  const q = questions[index];
  const answered = questions.filter((x) => x.answer).length;
  const correct = questions.filter((x) => x.answer?.correct).length;
  const finished = answered === questions.length;

  if (showResult)
    return (
      <Result
        attempt={attempt}
        correct={correct}
        total={questions.length}
        onRetry={onRetry}
        onWrongReview={onWrongReview}
        onExit={onExit}
      />
    );

  async function check() {
    const choice = picked[q.id];
    if (!choice) return;
    setChecking(true);
    const result = await SchatQuiz.answer(
      attemptId,
      q.id,
      q.questionType === "ox" ? { ox: choice } : { choiceId: choice }
    );
    setChecking(false);
    if (!result.success) return setError(result.error);
    setAttempt((prev) => ({
      ...prev,
      questions: prev.questions.map((x) =>
        x.id === q.id ? { ...x, answer: result } : x
      ),
    }));
  }

  return (
    <div className="flex flex-col gap-y-4">
      {notice && (
        <p
          className="rounded-xl bg-sky-500/10 px-4 py-2.5 text-sm text-sky-200 light:bg-sky-50 light:text-sky-800"
          data-testid="quiz-notice"
        >
          {notice}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px] md:items-start">
        <div className="flex min-w-0 flex-col gap-y-4">
          <QuestionCard
            q={q}
            index={index}
            total={questions.length}
            answered={answered}
            picked={
              picked[q.id] || q.answer?.selectedChoiceId || q.answer?.selectedOx
            }
            onPick={(value) =>
              !q.answer && setPicked((prev) => ({ ...prev, [q.id]: value }))
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                className={secondaryBtn}
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
              >
                이전
              </button>
              <button
                type="button"
                className={q.answer ? secondaryBtn : primaryBtn}
                disabled={!!q.answer || !picked[q.id] || checking}
                onClick={check}
              >
                {checking ? "확인 중..." : "정답 확인"}
              </button>
              {index < questions.length - 1 ? (
                <button
                  type="button"
                  className={q.answer ? primaryBtn : secondaryBtn}
                  disabled={!q.answer}
                  onClick={() => setIndex(index + 1)}
                >
                  다음
                </button>
              ) : (
                <button
                  type="button"
                  className={q.answer ? primaryBtn : secondaryBtn}
                  disabled={!finished}
                  onClick={() => setShowResult(true)}
                >
                  결과 보기
                </button>
              )}
            </div>
          </QuestionCard>
          {q.answer && <Explanation q={q} />}
        </div>
        <ScoreCard
          answered={answered}
          correct={correct}
          total={questions.length}
          finished={finished}
          onResult={() => setShowResult(true)}
          onExit={onExit}
        />
      </div>
    </div>
  );
}

export function QuestionCard({
  q,
  index,
  total,
  answered,
  picked,
  onPick,
  children,
}) {
  const result = q.answer;
  const optionClass = (value) => {
    const isPicked = picked === value;
    const isCorrect =
      result &&
      (q.questionType === "ox"
        ? result.correctOx === value
        : result.correctChoiceId === value);
    if (result && isCorrect)
      return "border-emerald-500 bg-emerald-500/10 light:bg-emerald-50";
    if (result && isPicked)
      return "border-red-500 bg-red-500/10 light:bg-red-50";
    if (isPicked) return "border-sky-500 bg-sky-500/10 light:bg-sky-50";
    return "border-zinc-700 hover:border-sky-500 light:border-slate-200";
  };
  return (
    <section
      className={`${card} p-5 md:p-6 flex flex-col gap-y-4`}
      data-testid="quiz-question"
    >
      <div className="flex items-center justify-between">
        <p className={`text-sm font-semibold ${strong}`}>문제 풀이 중</p>
        <p
          className={`text-sm font-semibold ${muted}`}
          data-testid="quiz-position"
        >
          {index + 1} / {total}
        </p>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-800 light:bg-slate-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
      >
        <div
          className="h-full rounded-full bg-sky-500 transition-all"
          style={{ width: `${total ? (answered / total) * 100 : 0}%` }}
        />
      </div>
      <p className={`text-xs ${muted}`}>
        {q.topic} · {q.difficultyLabel} · {q.questionTypeLabel}
      </p>
      <h2
        className={`text-base md:text-lg font-semibold leading-relaxed ${strong}`}
      >
        Q{index + 1}. {q.question}
      </h2>
      <div
        className="flex flex-col gap-y-2"
        role="radiogroup"
        aria-label="선택지"
      >
        {q.questionType === "ox"
          ? ["O", "X"].map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={picked === v}
                disabled={!!result}
                onClick={() => onPick(v)}
                className={`flex items-center gap-x-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${optionClass(v)} ${strong}`}
              >
                <span className="text-lg font-bold">{v}</span>
                <span>{v === "O" ? "맞다" : "틀리다"}</span>
              </button>
            ))
          : q.choices.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={picked === c.id}
                disabled={!!result}
                onClick={() => onPick(c.id)}
                className={`flex items-start gap-x-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${optionClass(c.id)} ${strong}`}
              >
                <span className="font-semibold">{c.letter}.</span>
                <span className="flex-1">{c.text}</span>
              </button>
            ))}
      </div>
      {children}
    </section>
  );
}

export function answerLabel(q, { choiceId, ox }) {
  if (q.questionType === "ox") return ox || "-";
  const c = q.choices.find((x) => x.id === choiceId);
  return c ? `${c.letter}. ${c.text}` : "-";
}

// 해설 및 근거: the stored explanation and source, with the existing
// Citation row for 근거 원문 보기 (PC inline PDF, mobile full-screen view).
export function Explanation({ q }) {
  const a = q.answer;
  const source = a.source || {};
  return (
    <section
      className={`${card} p-5 md:p-6 flex flex-col gap-y-3`}
      data-testid="quiz-explanation"
    >
      <div className="flex items-center gap-x-2">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            a.correct
              ? "bg-emerald-500/15 text-emerald-300 light:bg-emerald-50 light:text-emerald-700"
              : "bg-red-500/15 text-red-300 light:bg-red-50 light:text-red-700"
          }`}
        >
          {a.correct ? "정답입니다" : "오답입니다"}
        </span>
        <p className={`text-sm font-semibold ${strong}`}>해설 및 근거</p>
      </div>
      <p className={`text-sm ${strong}`}>
        정답: {answerLabel(q, { choiceId: a.correctChoiceId, ox: a.correctOx })}
      </p>
      {!a.correct && (
        <p className={`text-sm ${muted}`}>
          내가 고른 답:{" "}
          {answerLabel(q, { choiceId: a.selectedChoiceId, ox: a.selectedOx })}
        </p>
      )}
      <p className={`text-sm leading-relaxed whitespace-pre-wrap ${strong}`}>
        {a.explanation}
      </p>
      <div className="rounded-xl bg-zinc-800/60 px-4 light:bg-slate-50">
        <SourceEvidenceRow
          source={{
            documentName: source.documentName,
            page: source.page,
            pdfRef: source.pdfRef,
            excerpt: source.excerpt,
          }}
          index={0}
          workspaceSlug={source.workspaceSlug}
        />
      </div>
    </section>
  );
}

// 현재 점수 / 정답률, computed from the answers so far (no server call).
function ScoreCard({ answered, correct, total, finished, onResult, onExit }) {
  const rate = answered ? Math.round((correct / answered) * 100) : null;
  return (
    <aside
      className={`${card} p-5 flex flex-col gap-y-3`}
      data-testid="quiz-score"
    >
      <div>
        <p className={`text-xs ${muted}`}>현재 점수</p>
        <p className={`text-3xl font-bold ${strong}`}>
          {rate === null ? "-" : `${rate}점`}
        </p>
      </div>
      <div>
        <p className={`text-xs ${muted}`}>정답률</p>
        <p className={`text-sm font-semibold ${strong}`}>
          {correct} / {answered}
          {rate === null ? "" : ` (${rate}%)`}
        </p>
      </div>
      <p className={`text-xs ${muted}`}>
        진행 {answered} / {total}문항
      </p>
      {finished && (
        <button type="button" className={primaryBtn} onClick={onResult}>
          결과 보기
        </button>
      )}
      <button type="button" className={secondaryBtn} onClick={onExit}>
        종료
      </button>
    </aside>
  );
}

function Result({ attempt, correct, total, onRetry, onWrongReview, onExit }) {
  const score = total ? Math.round((correct / total) * 100) : 0;
  const wrong = total - correct;
  return (
    <section
      className={`${card} p-6 md:p-8 flex flex-col items-center gap-y-5 text-center`}
      data-testid="quiz-result"
    >
      <p className={`text-lg font-bold ${strong}`}>
        {attempt.mode === "wrong_review"
          ? "틀린 문제 다시 보기 완료"
          : "퀴즈 완료"}
      </p>
      <div className="grid w-full max-w-[520px] grid-cols-3 gap-3">
        {[
          ["점수", `${score}점`],
          ["정답", `${correct} / ${total}`],
          ["정답률", `${score}%`],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl bg-zinc-800/70 px-3 py-4 light:bg-slate-50"
          >
            <p className={`text-xs ${muted}`}>{label}</p>
            <p className={`mt-1 text-xl font-bold ${strong}`}>{value}</p>
          </div>
        ))}
      </div>
      <p className={`text-sm ${muted}`}>
        {wrong > 0
          ? `틀린 ${wrong}문제는 오답노트에 저장되었습니다.`
          : "모든 문제를 맞혔습니다."}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={secondaryBtn} onClick={onWrongReview}>
          틀린 문제 다시 보기
        </button>
        <button type="button" className={primaryBtn} onClick={onRetry}>
          다시 풀기
        </button>
        <button type="button" className={secondaryBtn} onClick={onExit}>
          종료
        </button>
      </div>
    </section>
  );
}

// 오답노트: the signed-in user's own wrong answers (stored explanations only).
function WrongNotes({ onReview }) {
  const [items, setItems] = useState(null);
  const load = () =>
    SchatQuiz.wrongNotes().then((r) => setItems(r?.success ? r.items : []));
  useEffect(() => {
    load();
  }, []);

  async function remove(id) {
    await SchatQuiz.removeWrongNote(id);
    load();
  }

  if (!items) return <p className={`text-sm ${muted}`}>불러오는 중...</p>;
  return (
    <div className="flex flex-col gap-y-4" data-testid="quiz-wrong-notes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={`text-sm ${muted}`}>
          틀린 문제는 자동으로 저장되고, 다시 풀어 맞히면 빠집니다. 나만 볼 수
          있습니다.
        </p>
        <button
          type="button"
          className={primaryBtn}
          disabled={!items.some((n) => n.available)}
          onClick={onReview}
        >
          틀린 문제 다시 보기
        </button>
      </div>
      {items.length === 0 ? (
        <p
          className={`rounded-xl border border-dashed border-zinc-700 light:border-slate-300 px-4 py-8 text-center text-sm ${muted}`}
        >
          오답노트가 비어 있습니다.
        </p>
      ) : (
        items.map((n) => (
          <article key={n.id} className={`${card} p-5 flex flex-col gap-y-2`}>
            <p className={`text-xs ${muted}`}>
              {n.topic} · {n.difficultyLabel} · 틀린 횟수 {n.wrongCount}
              {!n.available && " · 현재 출제되지 않는 문제"}
            </p>
            <p className={`text-sm font-semibold ${strong}`}>{n.question}</p>
            <p className="text-sm text-red-300 light:text-red-700">
              내가 선택한 답: {n.selectedText || "-"}
            </p>
            <p className="text-sm text-emerald-300 light:text-emerald-700">
              정답: {n.correctText}
            </p>
            <p
              className={`text-sm leading-relaxed whitespace-pre-wrap ${strong}`}
            >
              {n.explanation}
            </p>
            <div className="rounded-xl bg-zinc-800/60 px-4 light:bg-slate-50">
              <SourceEvidenceRow
                source={{
                  documentName: n.source.documentName,
                  page: n.source.page,
                  pdfRef: n.source.pdfRef,
                  excerpt: n.source.excerpt,
                }}
                index={0}
                workspaceSlug={n.source.workspaceSlug}
              />
            </div>
            <div>
              <button
                type="button"
                className={`${secondaryBtn} !py-1.5 !text-xs`}
                onClick={() => remove(n.id)}
              >
                오답노트에서 빼기
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

// 최근 퀴즈 기록: only the signed-in user's own completed quizzes.
function History() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    SchatQuiz.history().then((r) => setItems(r?.success ? r.items : []));
  }, []);
  if (!items) return <p className={`text-sm ${muted}`}>불러오는 중...</p>;
  if (items.length === 0)
    return (
      <p
        className={`rounded-xl border border-dashed border-zinc-700 light:border-slate-300 px-4 py-8 text-center text-sm ${muted}`}
      >
        아직 완료한 퀴즈가 없습니다.
      </p>
    );
  const date = (iso) =>
    new Date(iso).toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  return (
    <section className={`${card} p-5`} data-testid="quiz-history">
      <p className={`mb-3 text-xs ${muted}`}>내 기록만 표시됩니다.</p>
      <ul className="flex flex-col">
        {items.map((h) => (
          <li
            key={h.id}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 border-b border-zinc-800 py-2.5 text-sm last:border-b-0 light:border-slate-100"
          >
            <span className={muted}>{date(h.completedAt)}</span>
            <span className={`truncate ${strong}`}>{h.topic}</span>
            <span className={`font-semibold ${strong}`}>{h.score}점</span>
            <span className={muted}>
              {h.correct}/{h.total} ({h.rate}%)
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
