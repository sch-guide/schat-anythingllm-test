import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import SchatSynonyms from "@/models/schatSynonyms";
import showToast from "@/utils/toast";
import PdfPageViewer from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/PdfPageViewer";
import { Button, Loading, Notice, inputClass } from "../ui";
import { SCHAT_ADMIN_TITLE, findSchatAdminSection } from "../menu";
import {
  RUN_TRIGGER_LABELS,
  canOpenSource,
  cleanTerm,
  describeSources,
  groupSources,
  isNewAiGroup,
  reviewSelectedGroups,
  runTotals,
  saveSynonymGroup,
  synonymTableView,
  termKey,
  validateTerms,
} from "../synonymReview";
import "../synonymTable.css";

export const SYNONYM_STATUS_LABELS = {
  needs_review: { text: "검토 대기", tone: "pending" },
  active: { text: "사용 중", tone: "active" },
  off: { text: "사용 안 함", tone: "off" },
};
export const SYNONYM_KIND_LABELS = { procedure: "시술·기구", drug: "약물" };
export function splitTerms(value = "") {
  return String(value)
    .split(/[,=\n]/)
    .map(cleanTerm)
    .filter(Boolean);
}

function Sources({ group }) {
  const [source, setSource] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const sources = groupSources(group);
  const proposals = [
    group.suggestion,
    ...(group.pendingAdditions || []),
  ].filter(Boolean);
  return (
    <div className="synonym-sources">
      {sources.length ? (
        sources.map((item, index) => (
          <div key={index}>
            {canOpenSource(item) ? (
              <button
                type="button"
                className="synonym-source-link"
                onClick={() => {
                  setUnavailable(false);
                  setSource(item);
                }}
              >
                {describeSources([item])} 원문
              </button>
            ) : (
              <>
                <span>{describeSources([item])}</span>
                <small>원문을 열 수 없는 문서예요.</small>
              </>
            )}
          </div>
        ))
      ) : (
        <span>{group.source === "auto" ? "출처 없음" : "직접 등록"}</span>
      )}
      {proposals.map((item) => (
        <div key={item.id}>
          {item.reason && <small>{item.reason}</small>}
          {(item.test || item.lowConfidence || item.sourceMissing) && (
            <small>
              {[
                item.test && "검증용",
                item.lowConfidence && "낮은 확신",
                item.sourceMissing && "출처 없음",
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
          )}
          {item.status && item.status !== "pending" && (
            <small>
              {item.status === "approved"
                ? "승인됨"
                : "제외됨 · 필요 없음으로 기록"}
            </small>
          )}
        </div>
      ))}
      {source && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="동의어 근거 원문"
          className="synonym-source-dialog"
        >
          <div className="synonym-source-dialog-body">
            <div className="synonym-actions">
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

export function TermEditor({
  terms,
  setTerms,
  kind,
  setKind,
  status,
  setStatus,
  pending,
  error,
  disabled,
  onSave,
  onCancel,
  onRemove,
}) {
  const [word, setWord] = useState("");
  function append() {
    if (word.trim()) {
      setTerms([...terms, ...splitTerms(word)]);
      setWord("");
    }
  }
  return (
    <div className="synonym-editor" data-testid="synonym-term-editor">
      <div className="synonym-terms">
        {terms.map((term, index) => (
          <span key={index} className="synonym-chip synonym-editor-chip">
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
              style={{ width: `${Math.max(4, term.length + 1)}ch` }}
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
      <div className="synonym-editor-fields">
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
          className={inputClass}
        />
        <button
          type="button"
          disabled={disabled || !word.trim()}
          onClick={append}
        >
          단어 추가
        </button>
        <select
          aria-label="종류"
          value={kind}
          disabled={disabled}
          onChange={(event) => setKind(event.target.value)}
          className={inputClass}
        >
          {Object.entries(SYNONYM_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="synonym-error">
          {error}
        </p>
      )}
      <div className="synonym-editor-footer">
        <label className="synonym-toggle">
          <button
            type="button"
            role="switch"
            aria-label="묶음 사용"
            aria-checked={status === "active"}
            disabled={disabled || pending}
            onClick={() => setStatus(status === "active" ? "off" : "active")}
            className={`synonym-switch ${status === "active" ? "is-on" : ""}`}
          >
            <span />
          </button>
          {pending
            ? "등록하면 사용돼요"
            : status === "active"
              ? "사용 중"
              : "사용 안 함"}
        </label>
        {onRemove && (
          <button
            type="button"
            className="synonym-delete"
            disabled={disabled}
            onClick={onRemove}
          >
            묶음 삭제
          </button>
        )}
        <div className="synonym-actions">
          <Button variant="secondary" disabled={disabled} onClick={onCancel}>
            취소
          </Button>
          <Button
            disabled={disabled}
            onClick={() =>
              onSave(word.trim() ? [...terms, ...splitTerms(word)] : terms)
            }
          >
            {pending ? "저장 후 등록" : "저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function GroupRow({
  group,
  groups,
  disabled,
  editingElsewhere,
  onEditing = () => {},
  mutate,
  onReview,
  onReviewGroup,
  selected = false,
  onSelect = () => {},
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
  const pending = group.status === "needs_review";
  const locked = disabled || editingElsewhere;
  function startEdit() {
    if (locked) return;
    setTerms([...group.terms]);
    setKind(group.kind);
    setStatus(group.status);
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
    if (
      await mutate(() =>
        saveSynonymGroup(group, values, kind, status, SchatSynonyms)
      )
    )
      cancel();
  }
  async function remove() {
    if (
      window.confirm("이 묶음을 삭제할까요? 삭제한 묶음은 되돌릴 수 없어요.") &&
      (await mutate(() => SchatSynonyms.remove(group.id)))
    )
      cancel();
  }
  const label =
    SYNONYM_STATUS_LABELS[group.status] || SYNONYM_STATUS_LABELS.off;
  return (
    <tr
      className={editing ? "synonym-editing-row" : ""}
      data-synonym-group={group.id}
      data-synonym-new-group={isNewAiGroup(group) ? group.id : undefined}
    >
      <td data-label="선택">
        <input
          type="checkbox"
          aria-label={`${group.terms[0]} 묶음 선택`}
          disabled={locked || editing || !pending}
          checked={selected}
          onChange={(event) => onSelect(group.id, event.target.checked)}
        />
      </td>
      {editing ? (
        <td colSpan={5} className="synonym-editor-cell">
          <TermEditor
            terms={terms}
            setTerms={setTerms}
            kind={kind}
            setKind={setKind}
            status={status}
            setStatus={setStatus}
            pending={pending}
            error={error}
            disabled={disabled}
            onSave={save}
            onCancel={cancel}
            onRemove={remove}
          />
        </td>
      ) : (
        <>
          <td data-label="동의어">
            <div className="synonym-terms">
              {group.terms.map((term, index) =>
                pending ? (
                  <button
                    type="button"
                    key={index}
                    className="synonym-chip"
                    disabled={locked}
                    onClick={startEdit}
                  >
                    {term}
                  </button>
                ) : (
                  <span key={index} className="synonym-chip">
                    {term}
                  </span>
                )
              )}
            </div>
            {(group.pendingAdditions || [])
              .filter((item) => !item.status || item.status === "pending")
              .map((addition) => (
                <div
                  key={addition.id}
                  className="synonym-proposal-chip"
                  data-synonym-addition={addition.id}
                >
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => onReview(addition, true)}
                  >
                    제안 {addition.terms.join(", ")} 추가
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => onReview(addition, false)}
                  >
                    무시
                  </button>
                </div>
              ))}
          </td>
          <td data-label="분류">
            {SYNONYM_KIND_LABELS[group.kind] || group.kind}
          </td>
          <td data-label="출처">
            <Sources group={group} />
          </td>
          <td data-label="상태">
            <span className={`synonym-status synonym-status--${label.tone}`}>
              <span aria-hidden="true" />
              {label.text}
            </span>
          </td>
          <td data-label="작업">
            <div className="synonym-actions">
              {pending ? (
                <>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => onReviewGroup(group, true)}
                  >
                    등록
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => onReviewGroup(group, false)}
                  >
                    제외
                  </button>
                </>
              ) : (
                <button type="button" disabled={locked} onClick={startEdit}>
                  수정
                </button>
              )}
            </div>
          </td>
        </>
      )}
    </tr>
  );
}

export default function SynonymsSection() {
  const [groups, setGroups] = useState(null);
  const [filters, setFilters] = useState({
    query: "",
    kind: "",
    document: "",
    status: "all",
    page: 1,
  });
  const [selected, setSelected] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newTerms, setNewTerms] = useState([]);
  const [newKind, setNewKind] = useState("procedure");
  const [newStatus, setNewStatus] = useState("active");
  const [newError, setNewError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState(null);
  const [runs, setRuns] = useState([]);
  async function reload() {
    try {
      const list = await SchatSynonyms.list();
      if (list === null) {
        setLoadError(true);
        return false;
      }
      setGroups(list);
      setLoadError(false);
      return true;
    } catch {
      setLoadError(true);
      return false;
    }
  }
  useEffect(() => {
    reload();
    SchatSynonyms.runs()
      .then(setRuns)
      .catch(() => {});
  }, []);
  const view = useMemo(
    () => synonymTableView(groups || [], filters),
    [groups, filters]
  );
  useEffect(() => {
    // 저장된 분류가 현재 필터 밖으로 이동하면 사라진 편집행의 잠금을 해제한다.
    if (
      editingId !== null &&
      !view.rows.some((group) => group.id === editingId)
    )
      setEditingId(null);
  }, [editingId, view.rows]);
  function changeFilter(key, value) {
    setSelected([]);
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key !== "page" ? { page: 1 } : {}),
    }));
  }
  async function mutate(operation) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await operation();
      const success = Boolean(result.ok && result.success);
      const message = success
        ? result.message || "저장했어요."
        : result.error || "저장하지 못했어요. 수정 내용은 그대로 남아 있어요.";
      setNotice({ error: !success, text: message });
      showToast(message, success ? "success" : "error");
      await reload();
      setSelected([]);
      return success;
    } catch {
      const message =
        "서버에 연결하지 못했어요. 수정 내용은 그대로 남아 있어요. 목록을 다시 확인해 주세요.";
      setNotice({ error: true, text: message });
      showToast(message, "error");
      await reload();
      return false;
    } finally {
      setSelected([]);
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function reviewGroups(ids, approve) {
    if (
      inFlight.current ||
      !ids.length ||
      !window.confirm(
        `${ids.length}개 묶음을 ${approve ? "등록" : "제외"}할까요?`
      )
    )
      return;
    await mutate(async () => {
      const result = await reviewSelectedGroups(
        groups || [],
        ids,
        approve,
        SchatSynonyms
      );
      const message = `${result.completed.length}개 묶음을 ${approve ? "등록" : "제외"}했어요.`;
      return result.failed.length
        ? {
            ok: false,
            success: false,
            error: `${message} ${result.failed.length}개는 처리하지 못했어요. ${result.failed.map((item) => `#${item.id}: ${item.error}`).join(" / ")}`,
          }
        : { ok: true, success: true, message };
    });
  }
  async function reviewAddition(suggestion, approve) {
    if (inFlight.current) return;
    const group = (groups || []).find((item) =>
      item.pendingAdditions?.some((row) => row.id === suggestion.id)
    );
    if (approve && group) {
      const terms = [
        ...group.terms,
        ...suggestion.terms.filter(
          (term) =>
            !group.terms.some((value) => termKey(value) === termKey(term))
        ),
      ];
      const error = validateTerms(terms, groups, group);
      if (error) {
        setNotice({ error: true, text: error });
        return;
      }
    }
    if (
      window.confirm(
        approve ? "이 제안 단어를 묶음에 추가할까요?" : "이 제안을 무시할까요?"
      )
    )
      await mutate(() =>
        approve
          ? SchatSynonyms.approveAddition(suggestion.id)
          : SchatSynonyms.dismissAddition(suggestion.id)
      );
  }
  async function create(values) {
    const error = validateTerms(values, groups || []);
    if (error) {
      setNewError(error);
      return;
    }
    if (
      await mutate(() =>
        SchatSynonyms.create({
          terms: values.map(cleanTerm).filter(Boolean),
          kind: newKind,
          status: newStatus,
        })
      )
    )
      setCreating(false);
  }
  const locked = busy || loadError;
  const draftOpen = creating || editingId !== null;
  const selectable = view.rows.filter(
    (group) => group.status === "needs_review"
  );
  const pageNumbers = [
    ...new Set([
      1,
      view.pages,
      ...Array.from({ length: 5 }, (_, i) => view.page - 2 + i).filter(
        (page) => page >= 1 && page <= view.pages
      ),
    ]),
  ].sort((a, b) => a - b);
  const section = findSchatAdminSection("synonyms");
  const loading = groups === null && !loadError;
  const header = (
    <header className="synonym-header pb-5 border-b-2 border-theme-sidebar-border">
      <div className="flex flex-col gap-y-1">
        <p className="text-xs font-medium text-theme-text-secondary">
          {SCHAT_ADMIN_TITLE}
        </p>
        <h1 className="text-lg leading-6 font-bold text-theme-text-primary">
          {section.label}
        </h1>
        <p className="text-xs leading-5 text-theme-text-secondary">
          {section.description}
        </p>
      </div>
      <div className="synonym-top-actions">
        <Button
          disabled={loading || locked || draftOpen}
          onClick={() => {
            setSelected([]);
            setCreating(true);
            setNewTerms([]);
            setNewKind("procedure");
            setNewStatus("active");
            setNewError("");
          }}
        >
          + 새 묶음 추가
        </Button>
      </div>
    </header>
  );
  if (loading)
    return (
      <div className="synonym-management">
        {header}
        <Loading />
      </div>
    );
  return (
    <div className="synonym-management" data-testid="synonym-management">
      {header}
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
      {notice?.error && (
        <div role="alert">
          <Notice tone="warning">
            {notice.text}
          </Notice>
        </div>
      )}
      <section className="synonym-table-card" aria-label="동의어 목록">
        <div className="synonym-status-tabs" aria-label="상태 선택">
          {[
            ["all", "전체"],
            ["needs_review", "검토 대기"],
            ["active", "사용 중"],
            ["off", "사용 안 함"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filters.status === key}
              disabled={busy || draftOpen}
              onClick={() => changeFilter("status", key)}
            >
              {label}
              <span
                className={
                  key === "needs_review"
                    ? "synonym-count synonym-count--pending"
                    : "synonym-count"
                }
              >
                {view.counts[key]}
              </span>
            </button>
          ))}
        </div>
        <div className="synonym-toolbar">
          <div className="synonym-filters">
            <input
              aria-label="단어로 찾기"
              placeholder="단어로 찾기"
              value={filters.query}
              disabled={busy || draftOpen}
              onChange={(event) => changeFilter("query", event.target.value)}
              className={inputClass}
            />
            <select
              aria-label="분류 전체"
              value={filters.kind}
              disabled={busy || draftOpen}
              onChange={(event) => changeFilter("kind", event.target.value)}
              className={inputClass}
            >
              <option value="">분류 전체</option>
              {Object.entries(SYNONYM_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="문서 전체"
              value={filters.document}
              disabled={busy || draftOpen}
              onChange={(event) => changeFilter("document", event.target.value)}
              className={inputClass}
            >
              <option value="">문서 전체</option>
              {view.documents.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          {selected.length > 0 && (
            <div className="synonym-selection">
              <span>{selected.length}개 선택됨</span>
              <Button
                disabled={locked || draftOpen}
                onClick={() => reviewGroups(selected, true)}
              >
                묶음으로 등록
              </Button>
              <Button
                variant="secondary"
                disabled={locked || draftOpen}
                onClick={() => reviewGroups(selected, false)}
              >
                제외
              </Button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelected([])}
              >
                선택 해제
              </button>
            </div>
          )}
        </div>
        <div className="synonym-table-scroll">
          <table aria-label="동의어 관리 표" className="synonym-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="현재 페이지 검토 대기 전체 선택"
                    disabled={locked || draftOpen || !selectable.length}
                    checked={
                      selectable.length > 0 &&
                      selectable.every((group) => selected.includes(group.id))
                    }
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? selectable.map((group) => group.id)
                          : []
                      )
                    }
                  />
                </th>
                {["동의어", "분류", "출처", "상태", "작업"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {creating && (
                <tr className="synonym-editing-row" data-synonym-creating>
                  <td data-label="선택" />
                  <td colSpan={5} className="synonym-editor-cell">
                    <TermEditor
                      terms={newTerms}
                      setTerms={setNewTerms}
                      kind={newKind}
                      setKind={setNewKind}
                      status={newStatus}
                      setStatus={setNewStatus}
                      error={newError}
                      disabled={locked}
                      onSave={create}
                      onCancel={() => setCreating(false)}
                    />
                  </td>
                </tr>
              )}
              {view.sections.map((section) => (
                <Fragment key={section.status}>
                  {filters.status === "all" && (
                    <tr className="synonym-section-row">
                      <td colSpan={6}>
                        {SYNONYM_STATUS_LABELS[section.status].text}
                        {section.status === "needs_review" &&
                          " · AI가 지침에서 찾은 새 묶음"}
                      </td>
                    </tr>
                  )}
                  {section.groups.map((group) => (
                    <GroupRow
                      key={group.id}
                      group={group}
                      groups={groups || []}
                      disabled={locked}
                      editingElsewhere={
                        creating ||
                        (editingId !== null && editingId !== group.id)
                      }
                      onEditing={setEditingId}
                      mutate={mutate}
                      onReview={reviewAddition}
                      onReviewGroup={(item, approve) =>
                        reviewGroups([item.id], approve)
                      }
                      selected={selected.includes(group.id)}
                      onSelect={(id, checked) =>
                        setSelected((current) =>
                          checked
                            ? [...new Set([...current, id])]
                            : current.filter((item) => item !== id)
                        )
                      }
                    />
                  ))}
                </Fragment>
              ))}
              {!creating && !view.rows.length && (
                <tr>
                  <td colSpan={6} className="synonym-empty">
                    해당하는 묶음이 없어요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="synonym-pagination">
          <span>
            {view.start}–{view.end} / {view.total}개
          </span>
          <nav aria-label="동의어 목록 페이지">
            <button
              type="button"
              aria-label="이전 페이지"
              disabled={busy || draftOpen || view.page === 1}
              onClick={() => changeFilter("page", view.page - 1)}
            >
              이전
            </button>
            {pageNumbers.map((page) => (
              <button
                type="button"
                key={page}
                aria-label={`${page}페이지`}
                aria-current={view.page === page ? "page" : undefined}
                disabled={busy || draftOpen}
                onClick={() => changeFilter("page", page)}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              aria-label="다음 페이지"
              disabled={busy || draftOpen || view.page === view.pages}
              onClick={() => changeFilter("page", view.page + 1)}
            >
              다음
            </button>
          </nav>
        </div>
      </section>
      <details className="text-xs text-theme-text-secondary">
        <summary className="cursor-pointer">동의어 사용 안내</summary>
        <p className="mt-2 leading-6">
          사용 중인 묶음만 검색에 적용돼요. 검토 대기 묶음은 근거를 확인한 뒤
          등록해 주세요. 삽입과 제거처럼 다른 시술은 함께 묶을 수 없어요. 약물은
          비슷한 이름이어도 다른 약일 수 있으니 확실한 것만 넣어 주세요. 낮은
          확신·출처 없음·검증용 표시가 있으면 원문을 따로 확인해 주세요.
        </p>
      </details>
      <RunsCard key={runs[0]?.id ?? "none"} runs={runs} />
    </div>
  );
}
