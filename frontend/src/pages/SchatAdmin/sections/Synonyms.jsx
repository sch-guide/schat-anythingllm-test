import { useEffect, useMemo, useState } from "react";
import SchatSynonyms from "@/models/schatSynonyms";
import showToast from "@/utils/toast";
import { Badge, Button, Card, Loading, Notice, inputClass } from "../ui";

// "동의어 관리": 같은 뜻의 단어 묶음. "사용" 묶음만 검색과 체크리스트 연결에 쓰인다.

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

function GroupRow({ group, onSaved, onDeleted }) {
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
        {group.source === "draft" && <Badge tone="neutral">초안</Badge>}
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
    </li>
  );
}

export default function SynonymsSection() {
  const [groups, setGroups] = useState(null);
  const [filter, setFilter] = useState("needs_review");
  const [newTerms, setNewTerms] = useState("");
  const [newKind, setNewKind] = useState("procedure");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    SchatSynonyms.list().then((list) => setGroups(list || []));
  }, []);

  const counts = useMemo(() => {
    const result = { all: 0, needs_review: 0, active: 0, off: 0 };
    for (const group of groups || []) {
      result.all += 1;
      result[group.status] = (result[group.status] || 0) + 1;
    }
    return result;
  }, [groups]);

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
  const shown = groups.filter(
    (group) => filter === "all" || group.status === filter
  );

  return (
    <div className="flex flex-col gap-y-5">
      <Notice>
        같은 뜻의 단어를 묶어 두면, 질문에 그중 한 단어만 있어도 나머지 단어로도
        지침서를 찾고 체크리스트를 엽니다. <b>사용</b> 상태인 묶음만 적용됩니다.
        삽입과 제거처럼 서로 다른 시술 동작은 한 묶음에 넣을 수 없습니다. 약물은
        비슷한 이름이라도 다른 약일 수 있으니 확실한 것만 직접 넣어 주세요.
      </Notice>
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
                onSaved={(saved) =>
                  setGroups((current) =>
                    current.map((item) => (item.id === saved.id ? saved : item))
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
