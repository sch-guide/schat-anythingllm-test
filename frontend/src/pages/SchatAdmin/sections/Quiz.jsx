import { useCallback, useEffect, useState } from "react";
import SchatQuiz from "@/models/schatQuiz";
import showToast from "@/utils/toast";
import { Badge, Button, Card, Field, Loading, Notice, inputClass } from "../ui";
import QuizReviewDialog from "./QuizReview";
import QuizStats from "./QuizStats";
import { DIFFICULTIES, STATUSES, STATUS_TONE, TYPES } from "./quizLabels";

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : "-";

// 퀴즈 관리. AI is used only by "AI로 문제 만들기" and "다시 생성"; every other
// action here only edits stored questions.
export default function QuizSection() {
  const [tab, setTab] = useState("questions");
  const [listFilter, setListFilter] = useState({});
  const [usage, setUsage] = useState(null);
  const loadUsage = useCallback(
    () => SchatQuiz.usage().then((r) => setUsage(r?.success ? r : null)),
    []
  );
  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  return (
    <div className="flex flex-col gap-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="tablist">
          {[
            ["questions", "문제 목록"],
            ["sets", "퀴즈 세트"],
            ["generate", "문제 생성"],
            ["stats", "통계"],
          ].map(([key, label]) => (
            <Button
              key={key}
              role="tab"
              aria-selected={tab === key}
              variant={tab === key ? "primary" : "secondary"}
              onClick={() => setTab(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        <p
          className="text-xs text-theme-text-secondary"
          data-testid="quiz-usage"
        >
          오늘 AI 문제 생성: {usage?.today?.requests ?? "-"}회
        </p>
      </div>
      {tab === "questions" && (
        <QuestionList
          initialFilter={listFilter}
          key={JSON.stringify(listFilter)}
        />
      )}
      {tab === "sets" && (
        <SetList
          onOpen={(set) => {
            setListFilter({ quizSetId: String(set.id) });
            setTab("questions");
          }}
        />
      )}
      {tab === "generate" && (
        <Generate
          onDone={(result) => {
            loadUsage();
            setListFilter({ quizSetId: String(result.quizSetId) });
            setTab("questions");
          }}
          onFailed={loadUsage}
        />
      )}
      {tab === "stats" && <QuizStats />}
    </div>
  );
}

// ---- 문제 생성 ---------------------------------------------------------------------

function Generate({ onDone, onFailed }) {
  const [documents, setDocuments] = useState(null);
  const [form, setForm] = useState({
    docKey: "",
    topic: "",
    count: "10",
    difficulty: "intermediate",
    questionType: "multiple_choice",
  });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    SchatQuiz.documents().then((r) => {
      const docs = r?.documents || [];
      setDocuments(docs);
      if (docs[0])
        setForm((p) => ({ ...p, docKey: p.docKey || docs[0].docKey }));
    });
  }, []);

  const set = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    const result = await SchatQuiz.generate(form);
    setRunning(false);
    if (!result.success) {
      setError(
        result.error || "문제를 생성하지 못했습니다. 잠시 후 다시 시도해주세요."
      );
      onFailed?.();
      return;
    }
    showToast(
      `${result.created}문항을 작성중으로 저장했습니다. 검토 후 공개해 주세요.`,
      "success"
    );
    onDone(result);
  }

  if (!documents) return <Loading />;
  return (
    <Card
      title="문제 생성"
      description="선택한 문서에서 주제와 관련된 쪽만 찾아 AI에 보내고, 그 근거 안에서만 문제를 만듭니다. 만든 문제는 작성중으로 저장되며 관리자가 검토해 공개해야 직원에게 보입니다."
    >
      <Notice>
        AI는 문제를 생성할 때만 사용됩니다. 직원이 퀴즈를 푸는 동안에는 AI API를
        사용하지 않습니다.
      </Notice>
      <form
        onSubmit={submit}
        className="grid gap-4 md:grid-cols-2"
        data-testid="quiz-generate-form"
      >
        <Field label="대상 문서" htmlFor="qg-doc">
          <select
            id="qg-doc"
            className={inputClass}
            value={form.docKey}
            onChange={set("docKey")}
            required
          >
            {documents.map((d) => (
              <option key={d.docKey} value={d.docKey}>
                {d.name} ({d.pages}쪽)
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="주제"
          htmlFor="qg-topic"
          help="예: 수혈, 중심정맥관, 낙상 예방"
        >
          <input
            id="qg-topic"
            className={inputClass}
            value={form.topic}
            onChange={set("topic")}
            maxLength={60}
            required
          />
        </Field>
        <Field label="문항 수" htmlFor="qg-count" help="한 번에 1~20문항">
          <input
            id="qg-count"
            type="number"
            min={1}
            max={20}
            className={inputClass}
            value={form.count}
            onChange={set("count")}
            required
          />
        </Field>
        <Field label="난이도" htmlFor="qg-difficulty">
          <select
            id="qg-difficulty"
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
        <Field label="문제 유형" htmlFor="qg-type">
          <select
            id="qg-type"
            className={inputClass}
            value={form.questionType}
            onChange={set("questionType")}
          >
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={running || !form.docKey}>
            {running ? "문제를 만드는 중... (최대 1분)" : "AI로 문제 만들기"}
          </Button>
        </div>
      </form>
      {error && (
        <Notice tone="warning">
          <span role="alert">{error}</span>
        </Notice>
      )}
    </Card>
  );
}

// ---- 문제 목록 ---------------------------------------------------------------------

function QuestionList({ initialFilter = {} }) {
  const [filters, setFilters] = useState({
    q: "",
    docKey: "",
    topic: "",
    difficulty: "",
    questionType: "",
    status: "",
    quizSetId: "",
    ...initialFilter,
  });
  const [documents, setDocuments] = useState([]);
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState([]);
  const [reviewing, setReviewing] = useState(null);

  const load = useCallback(async () => {
    const r = await SchatQuiz.questions(filters);
    setRows(r?.questions || []);
    setSelected([]);
  }, [filters]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    SchatQuiz.documents().then((r) => setDocuments(r?.documents || []));
  }, []);

  const set = (key) => (e) =>
    setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  async function bulk(status) {
    const r = await SchatQuiz.setStatus(selected, status);
    if (!r.success) return showToast(r.error || "바꾸지 못했습니다.", "error");
    showToast(
      `${r.count}문항을 ${STATUSES.find((s) => s[0] === status)[1]}(으)로 바꿨습니다.`,
      "success"
    );
    load();
  }

  const allIds = (rows || []).map((r) => r.id);
  return (
    <Card
      title="문제 목록"
      description="AI가 만든 문제는 작성중으로 들어옵니다. 문제·선택지·정답·해설·출처를 검토한 뒤 공개하세요. 잘못된 문제는 먼저 사용중지하면 새 퀴즈에 나오지 않습니다."
    >
      <div className="grid gap-3 md:grid-cols-4">
        <input
          aria-label="문제 검색"
          placeholder="문제 검색"
          className={inputClass}
          value={filters.q}
          onChange={set("q")}
        />
        <select
          aria-label="문서 필터"
          className={inputClass}
          value={filters.docKey}
          onChange={set("docKey")}
        >
          <option value="">전체 문서</option>
          {documents.map((d) => (
            <option key={d.docKey} value={d.docKey}>
              {d.name}
            </option>
          ))}
        </select>
        <input
          aria-label="주제 필터"
          placeholder="주제"
          className={inputClass}
          value={filters.topic}
          onChange={set("topic")}
        />
        <select
          aria-label="상태 필터"
          className={inputClass}
          value={filters.status}
          onChange={set("status")}
        >
          <option value="">전체 상태</option>
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="난이도 필터"
          className={inputClass}
          value={filters.difficulty}
          onChange={set("difficulty")}
        >
          <option value="">전체 난이도</option>
          {DIFFICULTIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="유형 필터"
          className={inputClass}
          value={filters.questionType}
          onChange={set("questionType")}
        >
          <option value="">전체 유형</option>
          {TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {filters.quizSetId && (
          <div className="flex items-center gap-2 md:col-span-2">
            <Badge tone="neutral">
              퀴즈 세트 #{filters.quizSetId}의 문제만
            </Badge>
            <Button
              variant="secondary"
              className="!px-2.5 !py-1 !text-xs"
              onClick={() => setFilters((p) => ({ ...p, quizSetId: "" }))}
            >
              전체 보기
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!selected.length} onClick={() => bulk("approved")}>
          선택 공개
        </Button>
        <Button
          variant="secondary"
          disabled={!selected.length}
          onClick={() => bulk("inactive")}
        >
          선택 사용중지
        </Button>
        <span
          className="text-xs text-theme-text-secondary"
          data-testid="quiz-list-count"
        >
          {rows ? `${rows.length}문항` : ""}
          {selected.length ? ` · ${selected.length}개 선택` : ""}
        </span>
      </div>
      {!rows ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto">
          <table className="schat-quiz-table w-full min-w-[860px] text-sm text-left">
            <thead className="text-xs text-theme-text-secondary border-b border-theme-sidebar-border">
              <tr>
                <th className="py-2 pr-2 font-medium">
                  <input
                    type="checkbox"
                    aria-label="전체 선택"
                    className="h-4 w-4 accent-sky-600"
                    checked={rows.length > 0 && selected.length === rows.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? allIds : [])
                    }
                  />
                </th>
                <th className="py-2 pr-3 font-medium">문제</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">
                  문서
                </th>
                <th className="py-2 pr-3 font-medium">주제</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">
                  난이도
                </th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">
                  유형
                </th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">
                  출처
                </th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">
                  상태
                </th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">
                  생성일
                </th>
                <th className="py-2 font-medium text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-4 text-theme-text-secondary">
                    문제가 없습니다. 문제 생성 탭에서 만들 수 있습니다.
                  </td>
                </tr>
              )}
              {rows.map((q) => (
                <tr
                  key={q.id}
                  className="border-b border-theme-sidebar-border last:border-b-0 align-top"
                >
                  <td className="py-2.5 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`${q.id}번 문제 선택`}
                      className="h-4 w-4 accent-sky-600"
                      checked={selected.includes(q.id)}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked
                            ? [...prev, q.id]
                            : prev.filter((id) => id !== q.id)
                        )
                      }
                    />
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-primary max-w-[340px]">
                    <p className="line-clamp-2">{q.question}</p>
                    {q.reviewNote && (
                      <p className="text-xs text-amber-500 mt-0.5">
                        확인 필요: {q.reviewNote}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-secondary max-w-[160px]">
                    <span className="block truncate" title={q.documentName}>
                      {q.documentName}
                    </span>
                    {q.outdated && <Badge tone="warning">이전 문서 기반</Badge>}
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-secondary">
                    {q.topic}
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-secondary whitespace-nowrap">
                    {q.difficultyLabel}
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-secondary whitespace-nowrap">
                    {q.questionTypeLabel}
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-secondary whitespace-nowrap">
                    p.{q.sourcePage}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={STATUS_TONE[q.status]}>{q.statusLabel}</Badge>
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-secondary whitespace-nowrap">
                    {when(q.createdAt)}
                  </td>
                  <td className="py-2.5 text-right">
                    <Button
                      variant="secondary"
                      className="!px-2.5 !py-1 !text-xs"
                      onClick={() => setReviewing(q.id)}
                    >
                      검토
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reviewing && (
        <QuizReviewDialog
          id={reviewing}
          onClose={() => setReviewing(null)}
          onChanged={load}
        />
      )}
    </Card>
  );
}

// ---- 퀴즈 세트 ---------------------------------------------------------------------

function SetList({ onOpen }) {
  const [sets, setSets] = useState(null);
  const load = useCallback(
    () => SchatQuiz.sets().then((r) => setSets(r?.sets || [])),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  async function change(set, changes) {
    const r = await SchatQuiz.updateSet(set.id, changes);
    if (!r.success)
      return showToast(r.error || "저장하지 못했습니다.", "error");
    load();
  }

  if (!sets) return <Loading />;
  return (
    <Card
      title="퀴즈 세트"
      description="AI로 한 번 만든 문제 묶음입니다. 세트를 사용중지하면 그 안의 문제는 공개 상태여도 출제되지 않습니다. 직원에게는 공개된 문제만 나옵니다."
    >
      {sets.length === 0 ? (
        <p className="text-sm text-theme-text-secondary">
          퀴즈 세트가 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col">
          {sets.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-theme-sidebar-border last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-theme-text-primary">
                  {s.title}
                  {s.outdated && (
                    <span className="ml-2 align-middle">
                      <Badge tone="warning">이전 문서 기반</Badge>
                    </span>
                  )}
                </p>
                <p className="text-xs text-theme-text-secondary">
                  {s.documentName} · {s.topic} · {s.difficultyLabel} ·{" "}
                  {s.questionTypeLabel} · 문제 {s.questions}개 (공개{" "}
                  {s.approved} · 작성중 {s.draft}) · {when(s.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label={`${s.title} 상태`}
                  className={`${inputClass} !w-auto`}
                  value={s.status}
                  onChange={(e) => change(s, { status: e.target.value })}
                >
                  {STATUSES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" onClick={() => onOpen(s)}>
                  문제 보기
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
