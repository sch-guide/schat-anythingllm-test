import { useEffect, useMemo, useState } from "react";
import SchatSynonyms from "@/models/schatSynonyms";
import showToast from "@/utils/toast";
import { Badge, Button, Card, Loading, Notice, inputClass } from "../ui";
import {
  RUN_TRIGGER_LABELS,
  SOURCE_LABELS,
  confidenceText,
  countGroups,
  createdText,
  describeSources,
  inFilter,
  runTotals,
} from "../synonymReview";

// "동의어 관리": 같은 뜻의 단어 묶음. "사용" 묶음만 검색과 체크리스트 연결에 쓰인다.
// 문서 등록 후 자동 후보는 "검토 필요"와 "자동 제안" 표시로 들어온다.

export const SYNONYM_STATUS_LABELS = {
  needs_review: { text: "검토 필요", tone: "warning" },
  active: { text: "사용", tone: "ok" },
  off: { text: "끔", tone: "neutral" },
};

export const SYNONYM_KIND_LABELS = {
  procedure: "시술·기구",
  drug: "약물",
};

export function splitTerms(value = "") {
  return String(value)
    .split(/[,=\n]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

const FILTERS = [
  ["all", "전체"],
  ["needs_review", "검토 필요"],
  ["active", "사용"],
  ["off", "끔"],
];

// Review information for automatic suggestions (administrator only).
function SuggestionInfo({ suggestion }) {
  if (!suggestion) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-theme-text-secondary">
      <span>
        {suggestion.category && <>분류: {suggestion.category} · </>}
        출처: {describeSources(suggestion.sources)}
      </span>
      {suggestion.reason && <span>근거: {suggestion.reason}</span>}
      <span>
        {[
          confidenceText(suggestion.confidence),
          createdText(suggestion.createdAt),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}

// 자동 생성 실행 결과: 전체·신규·중복·실패와 문서별 후보 수.
function RunsCard({ runs }) {
  const [selected, setSelected] = useState(runs[0]?.id ?? null);
  if (!runs.length) return null;
  const run = runs.find((item) => item.id === selected) || runs[0];
  const failed = run.documents.filter((item) => item.status === "failed");
  return (
    <Card
      title="자동 생성 결과"
      description="문서 등록이나 기존 문서 한 번 실행으로 만든 후보의 결과입니다. 후보는 모두 검토 필요로만 들어갑니다."
    >
      <div className="flex flex-wrap gap-2" data-synonym-runs>
        {runs.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === run.id}
            onClick={() => setSelected(item.id)}
            className={`rounded-full border px-3 py-1 text-xs ${
              item.id === run.id
                ? "border-sky-500 bg-sky-500/15 font-semibold text-theme-text-primary"
                : "border-theme-sidebar-border text-theme-text-secondary"
            }`}
          >
            #{item.id} {RUN_TRIGGER_LABELS[item.trigger] || item.trigger}
            {item.test ? " · 검증용" : ""}
            {item.status === "running" ? " · 진행 중" : ""}
            {item.status === "removed" ? " · 삭제됨" : ""}
          </button>
        ))}
      </div>
      <div
        className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5"
        data-synonym-run-totals
      >
        {runTotals(run.summary).map((item) => (
          <div
            key={item.label}
            className="rounded-md border border-theme-sidebar-border px-2.5 py-1.5"
          >
            <div className="text-xs text-theme-text-secondary">
              {item.label}
            </div>
            <div className="text-base font-semibold text-theme-text-primary">
              {item.value}
            </div>
          </div>
        ))}
      </div>
      {failed.length > 0 && (
        <p className="mt-2 text-xs text-red-500">
          실패한 문서:{" "}
          {failed
            .map(
              (item) =>
                `${item.documentName}${item.error ? ` (${item.error})` : ""}`
            )
            .join(", ")}
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs" data-synonym-run-documents>
          <thead className="text-theme-text-secondary">
            <tr>
              <th className="py-1 pr-3 font-medium">문서명</th>
              <th className="py-1 pr-3 font-medium">쪽</th>
              <th className="py-1 pr-3 font-medium">후보</th>
              <th className="py-1 pr-3 font-medium">새 묶음</th>
              <th className="py-1 pr-3 font-medium">추가</th>
              <th className="py-1 pr-3 font-medium">중복</th>
              <th className="py-1 pr-3 font-medium">상태</th>
            </tr>
          </thead>
          <tbody className="text-theme-text-primary">
            {run.documents.map((item, index) => (
              <tr
                key={`${item.documentName}-${index}`}
                className="border-t border-theme-sidebar-border"
              >
                <td className="py-1 pr-3">{item.documentName}</td>
                <td className="py-1 pr-3">{item.pages}</td>
                <td className="py-1 pr-3">{item.candidates}</td>
                <td className="py-1 pr-3">{item.newGroups}</td>
                <td className="py-1 pr-3">{item.additions}</td>
                <td className="py-1 pr-3">{item.duplicates}</td>
                <td className="py-1 pr-3">
                  {item.statusText}
                  {item.error ? ` (${item.error})` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PendingAddition({ addition, group, onSaved, onClosed }) {
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    const result = await SchatSynonyms.approveAddition(addition.id);
    setBusy(false);
    if (!result.ok || !result.success) {
      showToast(result.error || "추가하지 못했습니다.", "error");
      return;
    }
    showToast("묶음에 단어를 추가했습니다.", "success");
    onSaved(result.group);
  }

  async function dismiss() {
    setBusy(true);
    const result = await SchatSynonyms.dismissAddition(addition.id);
    setBusy(false);
    if (!result.ok) return showToast("거절하지 못했습니다.", "error");
    onClosed(addition.id);
  }

  return (
    <div
      className="mt-2 rounded-md border border-dashed border-theme-sidebar-border px-2.5 py-2"
      data-synonym-addition={addition.id}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-theme-text-secondary">
        <Badge tone="warning">추가 후보</Badge>
        <Badge tone="neutral">{SOURCE_LABELS.auto}</Badge>
        {addition.test && <Badge tone="neutral">검증용</Badge>}
        {addition.lowConfidence && <Badge tone="neutral">낮은 확신</Badge>}
        {addition.sourceMissing && <Badge tone="danger">출처 없음</Badge>}
      </div>
      <p className="mt-1.5 text-sm text-theme-text-primary">
        기존 묶음: {group.terms.join(" / ")}
        <br />
        추가 후보: <b>{addition.terms.join(", ")}</b>
      </p>
      <SuggestionInfo suggestion={addition} />
      <div className="mt-2 flex gap-2">
        <Button disabled={busy} onClick={approve}>
          추가 승인
        </Button>
        <Button variant="secondary" disabled={busy} onClick={dismiss}>
          거절
        </Button>
      </div>
    </div>
  );
}

function GroupRow({ group, onSaved, onDeleted, onAdditionClosed }) {
  const [terms, setTerms] = useState(group.terms.join(", "));
  const [kind, setKind] = useState(group.kind);
  const [status, setStatus] = useState(group.status);
  const [busy, setBusy] = useState(false);
  const changed =
    terms !== group.terms.join(", ") ||
    kind !== group.kind ||
    status !== group.status;

  async function save() {
    setBusy(true);
    const result = await SchatSynonyms.update(group.id, {
      terms: splitTerms(terms),
      kind,
      status,
    });
    setBusy(false);
    if (!result.ok || !result.success) {
      showToast(result.error || "저장하지 못했습니다.", "error");
      return;
    }
    showToast("동의어를 저장했습니다.", "success");
    onSaved(result.group);
  }

  async function remove() {
    if (!window.confirm(`"${group.terms.join(" = ")}" 묶음을 삭제할까요?`))
      return;
    setBusy(true);
    const result = await SchatSynonyms.remove(group.id);
    setBusy(false);
    if (!result.ok) return showToast("삭제하지 못했습니다.", "error");
    onDeleted(group.id);
  }

  const label = SYNONYM_STATUS_LABELS[group.status];
  return (
    <li className="schat-admin-synonym rounded-lg border border-theme-sidebar-border px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-theme-text-secondary">
        <Badge tone={label.tone}>{label.text}</Badge>
        <span>{SYNONYM_KIND_LABELS[group.kind]}</span>
        {SOURCE_LABELS[group.source] && (
          <Badge tone="neutral">{SOURCE_LABELS[group.source]}</Badge>
        )}
        {group.suggestion?.test && <Badge tone="neutral">검증용</Badge>}
        {group.suggestion?.lowConfidence && (
          <Badge tone="neutral">낮은 확신</Badge>
        )}
        {group.suggestion?.sourceMissing && (
          <Badge tone="danger">출처 없음</Badge>
        )}
      </div>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <input
          aria-label="같은 뜻의 단어"
          value={terms}
          onChange={(event) => setTerms(event.target.value)}
          className={`${inputClass} md:flex-1`}
        />
        <select
          aria-label="종류"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className={`${inputClass} md:w-32`}
        >
          {Object.entries(SYNONYM_KIND_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <select
          aria-label="상태"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className={`${inputClass} md:w-32`}
        >
          {Object.entries(SYNONYM_STATUS_LABELS).map(([value, item]) => (
            <option key={value} value={value}>
              {item.text}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Button disabled={!changed || busy} onClick={save}>
            저장
          </Button>
          <Button variant="secondary" disabled={busy} onClick={remove}>
            삭제
          </Button>
        </div>
      </div>
      <SuggestionInfo suggestion={group.suggestion} />
      {(group.pendingAdditions || []).map((addition) => (
        <PendingAddition
          key={addition.id}
          addition={addition}
          group={group}
          onSaved={onSaved}
          onClosed={(id) => onAdditionClosed(group.id, id)}
        />
      ))}
    </li>
  );
}

export default function SynonymsSection() {
  const [groups, setGroups] = useState(null);
  const [filter, setFilter] = useState("needs_review");
  const [newTerms, setNewTerms] = useState("");
  const [newKind, setNewKind] = useState("procedure");
  const [adding, setAdding] = useState(false);

  const [runs, setRuns] = useState([]);

  useEffect(() => {
    SchatSynonyms.list().then((list) => setGroups(list || []));
    SchatSynonyms.runs().then(setRuns);
  }, []);

  const counts = useMemo(() => countGroups(groups || []), [groups]);

  async function add() {
    setAdding(true);
    const result = await SchatSynonyms.create({
      terms: splitTerms(newTerms),
      kind: newKind,
      status: "active",
    });
    setAdding(false);
    if (!result.ok || !result.success) {
      showToast(result.error || "추가하지 못했습니다.", "error");
      return;
    }
    showToast("동의어 묶음을 추가했습니다.", "success");
    setNewTerms("");
    setGroups((current) => [...current, result.group]);
  }

  if (groups === null) return <Loading />;
  const shown = groups.filter((group) => inFilter(group, filter));
  // A saved group keeps its review information until the list is reloaded,
  // except additions that were just approved (now part of the group).
  const replaceGroup = (saved) =>
    setGroups((current) =>
      current.map((item) =>
        item.id === saved.id
          ? {
              ...item,
              ...saved,
              pendingAdditions: (item.pendingAdditions || []).filter(
                (addition) =>
                  !addition.terms.every((term) => saved.terms.includes(term))
              ),
            }
          : item
      )
    );

  return (
    <div className="flex flex-col gap-y-5">
      <Notice>
        같은 뜻의 단어를 묶어 두면, 질문에 그중 한 단어만 있어도 나머지 단어로도
        지침서를 찾고 체크리스트를 엽니다. <b>사용</b> 상태인 묶음만 적용됩니다.
        삽입과 제거처럼 서로 다른 시술 동작은 한 묶음에 넣을 수 없습니다. 약물은
        비슷한 이름이라도 다른 약일 수 있으니 확실한 것만 직접 넣어 주세요.
        문서를 등록하면 AI가 찾은 후보가 <b>자동 제안</b>으로 검토 필요에
        들어옵니다. 확인한 뒤 <b>사용</b>으로 바꿔야 검색에 쓰입니다.
      </Notice>
      <RunsCard key={runs[0]?.id ?? "none"} runs={runs} />
      <Card
        title="새 묶음 추가"
        description="단어는 쉼표(,)로 구분합니다. 추가하면 바로 사용됩니다."
      >
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            aria-label="새 묶음 단어"
            placeholder="예: 카테터, cath, catheter"
            value={newTerms}
            onChange={(event) => setNewTerms(event.target.value)}
            className={`${inputClass} md:flex-1`}
          />
          <select
            aria-label="새 묶음 종류"
            value={newKind}
            onChange={(event) => setNewKind(event.target.value)}
            className={`${inputClass} md:w-32`}
          >
            {Object.entries(SYNONYM_KIND_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
          <Button
            disabled={adding || splitTerms(newTerms).length < 2}
            onClick={add}
          >
            추가
          </Button>
        </div>
      </Card>
      <Card>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-full border px-3 py-1 text-sm ${
                filter === key
                  ? "border-sky-500 bg-sky-500/15 font-semibold text-theme-text-primary"
                  : "border-theme-sidebar-border text-theme-text-secondary"
              }`}
            >
              {label} {counts[key] || 0}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-theme-text-secondary">
            해당하는 묶음이 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-y-2">
            {shown.map((group) => (
              <GroupRow
                key={`${group.id}:${group.updatedAt}`}
                group={group}
                onSaved={replaceGroup}
                onAdditionClosed={(groupId, additionId) =>
                  setGroups((current) =>
                    current.map((item) =>
                      item.id === groupId
                        ? {
                            ...item,
                            pendingAdditions: item.pendingAdditions.filter(
                              (addition) => addition.id !== additionId
                            ),
                          }
                        : item
                    )
                  )
                }
                onDeleted={(id) =>
                  setGroups((current) =>
                    current.filter((item) => item.id !== id)
                  )
                }
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
