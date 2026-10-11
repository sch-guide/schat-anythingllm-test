import { useEffect, useMemo, useRef, useState } from "react";
import SchatSynonyms from "@/models/schatSynonyms";
import showToast from "@/utils/toast";
import PdfPageViewer from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/PdfPageViewer";
import { Badge, Button, Card, Loading, Notice, inputClass } from "../ui";
import {
  RUN_TRIGGER_LABELS,
  SOURCE_LABELS,
  canOpenSource,
  cleanTerm,
  confidenceText,
  createdText,
  describeSources,
  managementView,
  runTotals,
  termKey,
  validateTerms,
} from "../synonymReview";

export const SYNONYM_STATUS_LABELS = {
  needs_review: { text: "검토 필요 · 꺼짐", tone: "neutral" },
  active: { text: "사용", tone: "ok" },
  off: { text: "꺼짐", tone: "neutral" },
};
export const SYNONYM_KIND_LABELS = { procedure: "시술·기구", drug: "약물" };
export function splitTerms(value = "") {
  return String(value)
    .split(/[,=\n]/)
    .map(cleanTerm)
    .filter(Boolean);
}

function SuggestionInfo({ suggestion }) {
  const [source, setSource] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  if (!suggestion) return null;
  return (
    <div className="mt-2 space-y-1 text-xs text-theme-text-secondary">
      <div className="flex flex-wrap gap-1.5">
        {suggestion.test && <Badge>검증용</Badge>}
        {suggestion.lowConfidence && <Badge tone="warning">낮은 확신</Badge>}
        {suggestion.sourceMissing && <Badge tone="danger">출처 없음</Badge>}
        {suggestion.status !== "pending" && (
          <Badge>
            {suggestion.status === "approved" ? "승인됨" : "필요 없음으로 기록"}
          </Badge>
        )}
      </div>
      <p>근거: {suggestion.reason || "문서에서 같은 뜻으로 찾았어요."}</p>
      {(suggestion.sources || []).map((item, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <span>출처: {describeSources([item])}</span>
          {canOpenSource(item) ? (
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => {
                setUnavailable(false);
                setSource(item);
              }}
            >
              원문 보기
            </button>
          ) : (
            <span>원문을 열 수 없는 문서예요.</span>
          )}
        </div>
      ))}
      {!suggestion.sources?.length && <p>출처 정보가 없어요.</p>}
      <details>
        <summary className="cursor-pointer">제안 정보</summary>
        <p>
          {[
            suggestion.category ? `분류: ${suggestion.category}` : "",
            confidenceText(suggestion.confidence),
            createdText(suggestion.createdAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {(suggestion.lowConfidence || suggestion.sourceMissing) && (
          <p>확신이 낮거나 출처가 없으면 원문을 따로 확인한 뒤 넣어 주세요.</p>
        )}
      </details>
      {source && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="동의어 근거 원문"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
        >
          <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl bg-theme-bg-primary p-4">
            <div className="mb-3 flex justify-between gap-2">
              <b>{source.documentName}</b>
              <Button variant="secondary" onClick={() => setSource(null)}>
                닫기
              </Button>
            </div>
            {unavailable ? (
              <Notice>
                원문을 열지 못했어요. 문서가 남아 있는지 확인해 주세요.
              </Notice>
            ) : (
              <PdfPageViewer
                workspaceSlug={source.workspaceSlug}
                pdfRef={source.pdfRef}
                page={source.pages?.[0] || 1}
                documentName={source.documentName}
                onUnavailable={() => setUnavailable(true)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RunsCard({ runs }) {
  const [selected, setSelected] = useState(runs[0]?.id);
  if (!runs.length) return null;
  const run = runs.find((item) => item.id === selected) || runs[0];
  const failed = (run.documents || []).filter(
    (item) => item.status === "failed"
  );
  return (
    <details className="schat-admin-card rounded-xl p-4">
      <summary className="cursor-pointer text-sm font-medium text-theme-text-primary">
        자동 생성 결과
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <select
          aria-label="자동 생성 실행 기록"
          value={run.id}
          onChange={(event) => setSelected(Number(event.target.value))}
          className={inputClass}
        >
          {runs.map((item) => (
            <option key={item.id} value={item.id}>
              #{item.id} {RUN_TRIGGER_LABELS[item.trigger] || item.trigger}
              {item.test ? " · 검증용" : ""} ·{" "}
              {item.status === "running"
                ? "진행 중"
                : item.status === "removed"
                  ? "삭제됨"
                  : "완료"}
            </option>
          ))}
        </select>
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-5"
          data-synonym-run-totals
        >
          {runTotals(run.summary).map((item) => (
            <div
              key={item.label}
              className="rounded-md border border-theme-sidebar-border p-2 text-xs text-theme-text-secondary"
            >
              {item.label}{" "}
              <b className="text-theme-text-primary">{item.value}</b>
            </div>
          ))}
        </div>
        {failed.length > 0 && (
          <p className="text-xs text-red-500">
            실패한 문서:{" "}
            {failed
              .map((item) => `${item.documentName} (${item.error || "실패"})`)
              .join(", ")}
          </p>
        )}
        <div className="overflow-x-auto">
          <table
            className="w-full text-left text-xs text-theme-text-primary"
            data-synonym-run-documents
          >
            <thead>
              <tr>
                {[
                  "문서명",
                  "쪽",
                  "후보",
                  "새 묶음",
                  "추가",
                  "중복",
                  "상태",
                ].map((text) => (
                  <th key={text} className="p-1 font-medium">
                    {text}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(run.documents || []).map((item, index) => (
                <tr
                  key={index}
                  className="border-t border-theme-sidebar-border"
                >
                  {[
                    item.documentName,
                    item.pages,
                    item.candidates,
                    item.newGroups,
                    item.additions,
                    item.duplicates,
                    `${item.statusText || item.status}${item.error ? ` (${item.error})` : ""}`,
                  ].map((value, i) => (
                    <td key={i} className="p-1">
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function Chips({ terms, onEdit, pending = false, active = false }) {
  return (
    <div className="flex flex-wrap gap-2">
      {terms.map((term, index) =>
        onEdit ? (
          <button
            type="button"
            key={index}
            onClick={onEdit}
            className={`rounded-full border px-3 py-1 text-sm ${active ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-gray-200 bg-gray-100 text-gray-600"}`}
          >
            {term}
          </button>
        ) : (
          <span
            key={index}
            className={`rounded-full border px-3 py-1 text-sm ${pending ? "border-dashed border-amber-400 bg-amber-50 text-amber-950" : "border-theme-sidebar-border bg-theme-bg-primary"}`}
          >
            {term}
          </span>
        )
      )}
    </div>
  );
}

function TermEditor({
  terms,
  setTerms,
  kind,
  setKind,
  error,
  disabled,
  onSave,
  onCancel,
}) {
  const [word, setWord] = useState("");
  function append() {
    if (!word.trim()) return;
    setTerms([...terms, ...splitTerms(word)]);
    setWord("");
  }
  return (
    <div
      className="space-y-3 rounded-lg border border-teal-300 p-3"
      data-testid="synonym-term-editor"
    >
      <div className="flex flex-wrap gap-2">
        {terms.map((term, index) => (
          <span
            key={index}
            className="flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-sm text-teal-950"
          >
            <input
              aria-label={`단어 ${index + 1}`}
              value={term}
              disabled={disabled}
              onChange={(event) =>
                setTerms(
                  terms.map((value, i) =>
                    i === index ? event.target.value : value
                  )
                )
              }
              className="min-w-0 bg-transparent outline-none"
              style={{
                width: `${Math.max(4, term.length + 1)}ch`,
                maxWidth: "45vw",
              }}
            />
            <button
              type="button"
              aria-label={`${term || "빈 단어"} 삭제`}
              disabled={disabled}
              onClick={() => setTerms(terms.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="추가할 단어"
          placeholder="+ 단어 (Enter로 추가)"
          value={word}
          disabled={disabled}
          onChange={(event) => setWord(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent?.isComposing) {
              event.preventDefault();
              append();
            }
          }}
          className={`${inputClass} sm:flex-1`}
        />
        <button
          type="button"
          disabled={disabled || !word.trim()}
          onClick={append}
          className="text-sm text-theme-text-secondary"
        >
          단어 추가
        </button>
        <select
          aria-label="종류"
          value={kind}
          disabled={disabled}
          onChange={(event) => setKind(event.target.value)}
          className={`${inputClass} sm:w-36`}
        >
          {Object.entries(SYNONYM_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={disabled} onClick={onCancel}>
          취소
        </Button>
        <Button
          disabled={disabled}
          onClick={() =>
            onSave(word.trim() ? [...terms, ...splitTerms(word)] : terms)
          }
        >
          저장
        </Button>
      </div>
    </div>
  );
}

function Proposal({ suggestion, isGroup = false, disabled, onReview }) {
  return (
    <div
      className="rounded-lg border border-dashed border-amber-400 bg-amber-50/70 p-3"
      data-synonym-addition={isGroup ? undefined : suggestion.id}
    >
      <p className="mb-2 text-xs font-medium text-amber-950">
        {isGroup ? "새 묶음 제안" : "추가 후보"}
      </p>
      <Chips terms={suggestion.terms} pending />
      <SuggestionInfo suggestion={suggestion} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={disabled} onClick={() => onReview(suggestion, true)}>
          {isGroup ? "묶음으로 만들기" : "넣기"}
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => onReview(suggestion, false)}
        >
          {isGroup ? "필요 없음" : "빼기"}
        </Button>
      </div>
    </div>
  );
}

export function GroupRow({
  group,
  groups,
  disabled,
  editingElsewhere,
  onEditing,
  mutate,
  onReview,
}) {
  const [editing, setEditing] = useState(false);
  const [terms, setTerms] = useState(group.terms);
  const [kind, setKind] = useState(group.kind);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(group.status);
  useEffect(() => {
    if (!editing) {
      setTerms(group.terms);
      setKind(group.kind);
      setStatus(group.status);
    }
  }, [group, editing]);
  function startEdit() {
    if (disabled || editingElsewhere) return;
    setTerms([...group.terms]);
    setKind(group.kind);
    setError("");
    setEditing(true);
    onEditing(group.id);
  }
  function cancel() {
    setEditing(false);
    setError("");
    onEditing(null);
  }
  async function save(values) {
    const problem = validateTerms(values, groups, group);
    if (problem) {
      setError(problem);
      return;
    }
    const saved = await mutate(() =>
      SchatSynonyms.update(group.id, {
        terms: values.map(cleanTerm).filter(Boolean),
        kind,
      })
    );
    if (saved) cancel();
  }
  async function toggle() {
    const next = status === "active" ? "off" : "active";
    setStatus(next);
    if (!(await mutate(() => SchatSynonyms.update(group.id, { status: next }))))
      setStatus(group.status);
  }
  async function changeKind(next) {
    setKind(next);
    if (!(await mutate(() => SchatSynonyms.update(group.id, { kind: next }))))
      setKind(group.kind);
  }
  async function remove() {
    if (window.confirm("이 묶음을 지울까요?"))
      await mutate(() => SchatSynonyms.remove(group.id));
  }
  const label = SYNONYM_STATUS_LABELS[status] || SYNONYM_STATUS_LABELS.off;
  const pending = (group.pendingAdditions || []).length > 0;
  return (
    <li
      className={`schat-admin-synonym rounded-xl border p-4 ${pending ? "border-amber-200 bg-amber-50/50" : status === "active" ? "border-emerald-200 bg-emerald-50/40" : "border-theme-sidebar-border bg-black/[0.03]"}`}
      data-synonym-group={group.id}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={label.tone}>{label.text}</Badge>
          {!editing && (
            <select
              aria-label="종류"
              value={kind}
              disabled={disabled || editingElsewhere}
              onChange={(event) => changeKind(event.target.value)}
              className={`${inputClass} !w-auto !py-1`}
            >
              {Object.entries(SYNONYM_KIND_LABELS).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          )}
          <Badge>{SOURCE_LABELS[group.source] || group.source}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-label={`${group.terms[0]} 묶음 사용`}
            aria-checked={status === "active"}
            disabled={disabled || editing || editingElsewhere}
            onClick={toggle}
            className={`relative h-6 w-11 rounded-full disabled:opacity-50 ${status === "active" ? "bg-emerald-500" : "bg-gray-400"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${status === "active" ? "left-[22px]" : "left-0.5"}`}
            />
          </button>
          <button
            type="button"
            disabled={disabled || editing || editingElsewhere}
            onClick={startEdit}
            className="text-xs text-theme-text-secondary underline"
          >
            수정
          </button>
          <button
            type="button"
            aria-label="묶음 삭제"
            title="묶음 삭제"
            disabled={disabled || editing || editingElsewhere}
            onClick={remove}
            className="text-sm text-theme-text-secondary"
          >
            🗑
          </button>
        </div>
      </div>
      {editing ? (
        <TermEditor
          terms={terms}
          setTerms={setTerms}
          kind={kind}
          setKind={setKind}
          error={error}
          disabled={disabled}
          onSave={save}
          onCancel={cancel}
        />
      ) : (
        <Chips
          terms={group.terms}
          onEdit={startEdit}
          active={status === "active"}
        />
      )}
      {group.status === "needs_review" && (
        <p className="mt-2 text-xs text-theme-text-secondary">
          확인한 뒤 사용을 켜면 검색에 적용돼요.
        </p>
      )}
      <SuggestionInfo suggestion={group.suggestion} />
      <div className="mt-3 space-y-2">
        {(group.pendingAdditions || []).map((addition) => (
          <Proposal
            key={addition.id}
            suggestion={addition}
            disabled={disabled || editing || editingElsewhere}
            onReview={onReview}
          />
        ))}
      </div>
    </li>
  );
}

export default function SynonymsSection() {
  const [groups, setGroups] = useState(null);
  const [query, setQuery] = useState("");
  const [aiOnly, setAiOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTerms, setNewTerms] = useState([]);
  const [newKind, setNewKind] = useState("procedure");
  const [newError, setNewError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const [bulkNotice, setBulkNotice] = useState(null);
  const [runs, setRuns] = useState([]);
  async function reload() {
    const list = await SchatSynonyms.list();
    if (list === null) {
      setLoadError(true);
      return false;
    }
    setGroups(list);
    setLoadError(false);
    return true;
  }
  useEffect(() => {
    reload();
    SchatSynonyms.runs().then(setRuns);
  }, []);
  const view = useMemo(
    () => managementView(groups || [], query, aiOnly),
    [groups, query, aiOnly]
  );
  async function mutate(operation) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setBulkNotice(null);
    try {
      const result = await operation();
      if (!result.ok || !result.success) {
        showToast(result.error || "저장하지 못했어요.", "error");
        await reload();
        return false;
      }
      showToast("저장했어요.", "success");
      await reload();
      return true;
    } catch {
      showToast("서버에 연결하지 못했어요.", "error");
      await reload();
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function review(suggestion, approve) {
    const group = (groups || []).find(
      (item) =>
        item.suggestion?.id === suggestion.id ||
        item.pendingAdditions?.some((row) => row.id === suggestion.id)
    );
    if (approve && group) {
      const terms =
        group.suggestion?.id === suggestion.id
          ? group.terms
          : [
              ...group.terms,
              ...suggestion.terms.filter(
                (term) =>
                  !group.terms.some((value) => termKey(value) === termKey(term))
              ),
            ];
      const error = validateTerms(terms, groups, group);
      if (error) {
        showToast(error, "error");
        return;
      }
    }
    await mutate(() =>
      approve
        ? SchatSynonyms.approveAddition(suggestion.id)
        : SchatSynonyms.dismissAddition(suggestion.id)
    );
  }
  async function bulk() {
    if (
      inFlight.current ||
      !view.proposalIds.length ||
      !window.confirm(`제안 ${view.proposalIds.length}개를 넣을까요?`)
    )
      return;
    const ids = [...view.proposalIds];
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await SchatSynonyms.approveVisible(ids);
      if (!result.ok || !result.success)
        setBulkNotice({
          error:
            result.error || "제안을 넣지 못했어요. 목록을 다시 확인해 주세요.",
        });
      else {
        setBulkNotice(result);
        if (!result.failed?.length && !result.skipped?.length)
          showToast("저장했어요.", "success");
      }
      await reload();
    } catch {
      setBulkNotice({
        error: "서버에 연결하지 못했어요. 목록을 다시 확인해 주세요.",
      });
      await reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function create(values) {
    const error = validateTerms(values, groups);
    if (error) {
      setNewError(error);
      return;
    }
    if (
      await mutate(() =>
        SchatSynonyms.create({
          terms: values.map(cleanTerm).filter(Boolean),
          kind: newKind,
          status: "active",
        })
      )
    )
      setCreating(false);
  }
  const locked = busy || loadError;
  const draftOpen = creating || editingId !== null;
  if (groups === null && !loadError) return <Loading />;
  return (
    <div className="flex flex-col gap-5" data-testid="synonym-management">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="단어로 찾기"
          placeholder="단어로 찾기"
          value={query}
          disabled={draftOpen}
          onChange={(event) => setQuery(event.target.value)}
          className={`${inputClass} sm:flex-1`}
        />
        <Button
          disabled={locked || draftOpen}
          onClick={() => {
            setCreating(true);
            setNewTerms([]);
            setNewKind("procedure");
            setNewError("");
          }}
        >
          + 새 묶음 추가
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={!aiOnly}
          disabled={draftOpen}
          onClick={() => setAiOnly(false)}
          className={`rounded-full border px-3 py-1.5 text-sm ${!aiOnly ? "border-teal-500 bg-teal-50 text-teal-950" : "border-theme-sidebar-border text-theme-text-secondary"}`}
        >
          전체 {view.total}묶음
        </button>
        <button
          type="button"
          aria-pressed={aiOnly}
          disabled={draftOpen}
          onClick={() => setAiOnly(true)}
          className={`rounded-full border px-3 py-1.5 text-sm ${aiOnly ? "border-amber-400 bg-amber-50 text-amber-950" : "border-theme-sidebar-border text-theme-text-secondary"}`}
        >
          💡 AI 제안 있는 것만 {view.aiCount}
        </button>
        <Button
          variant="secondary"
          className="sm:ml-auto"
          disabled={locked || draftOpen || !view.proposalIds.length}
          onClick={bulk}
        >
          보이는 제안 모두 넣기
        </Button>
      </div>
      {loadError && (
        <Notice tone="warning">
          목록을 불러오지 못했어요. 새로 확인한 뒤 다시 저장해 주세요.{" "}
          <button
            type="button"
            className="underline"
            disabled={busy}
            onClick={reload}
          >
            다시 불러오기
          </button>
        </Notice>
      )}
      {bulkNotice && (
        <Notice
          tone={
            bulkNotice.error || bulkNotice.failed?.length ? "warning" : "info"
          }
        >
          {bulkNotice.error ||
            `제안 ${bulkNotice.approved?.length || 0}개를 넣었어요. 이미 처리된 제안 ${bulkNotice.skipped?.length || 0}개, 넣지 못한 제안 ${bulkNotice.failed?.length || 0}개예요.`}
          {bulkNotice.failed?.map((item) => (
            <p key={item.id}>
              제안 #{item.id}: {item.error}
            </p>
          ))}
        </Notice>
      )}
      {view.newGroups.length > 0 && (
        <Card
          title="AI가 찾은 새 묶음"
          description="근거를 확인한 뒤 필요한 묶음만 넣어 주세요."
        >
          {view.newGroups.map((group) => (
            <div key={group.id} data-synonym-new-group={group.id}>
              <Proposal
                suggestion={{ ...group.suggestion, terms: group.terms }}
                isGroup
                disabled={locked || draftOpen}
                onReview={review}
              />
              {(group.pendingAdditions || []).map((item) => (
                <div key={item.id} className="ml-3 mt-2">
                  <Proposal
                    suggestion={item}
                    disabled={locked || draftOpen}
                    onReview={review}
                  />
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}
      <Card title="사용 중인 묶음">
        <ul className="space-y-3">
          {creating && (
            <li>
              <TermEditor
                terms={newTerms}
                setTerms={setNewTerms}
                kind={newKind}
                setKind={setNewKind}
                error={newError}
                disabled={locked}
                onSave={create}
                onCancel={() => setCreating(false)}
              />
            </li>
          )}
          {view.mainGroups.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              groups={groups || []}
              disabled={locked}
              editingElsewhere={
                creating || (editingId !== null && editingId !== group.id)
              }
              onEditing={setEditingId}
              mutate={mutate}
              onReview={review}
            />
          ))}
        </ul>
        {!creating && !view.mainGroups.length && (
          <p className="text-sm text-theme-text-secondary">
            해당하는 묶음이 없어요.
          </p>
        )}
      </Card>
      <details className="text-xs text-theme-text-secondary">
        <summary className="cursor-pointer">동의어 사용 안내</summary>
        <p className="mt-2 leading-6">
          사용을 켠 묶음만 검색에 적용돼요. 초안은 확인한 뒤 직접 켜 주세요.
          삽입과 제거처럼 다른 시술은 함께 묶을 수 없어요. 약물은 비슷한
          이름이어도 다른 약일 수 있으니 확실한 것만 넣어 주세요. AI 제안은 낮은
          확신·출처 없음·검증용 표시와 근거를 함께 확인해 주세요.
        </p>
      </details>
      <RunsCard key={runs[0]?.id ?? "none"} runs={runs} />
    </div>
  );
}
