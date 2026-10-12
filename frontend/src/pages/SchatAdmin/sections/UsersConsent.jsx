import { useCallback, useEffect, useState } from "react";
import SchatAccount from "@/models/schatAccount";
import showToast from "@/utils/toast";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import { Badge, Button, Card, Field, Loading, Notice, inputClass } from "../ui";

const when = (iso) => (iso ? new Date(iso).toLocaleDateString("ko-KR") : "-");

const FIELDS = [
  ["summary.items", "수집 항목", 2],
  ["summary.purpose", "이용 목적", 2],
  ["summary.retention", "보관 기간", 2],
  ["summary.refusal", "거부 권리", 2],
  ["external.storage", "저장 위치", 1],
  ["external.generation", "답변 생성", 2],
];

const read = (content, path) =>
  path.split(".").reduce((value, key) => value?.[key], content) ?? "";
function write(content, path, value) {
  const [group, key] = path.split(".");
  return { ...content, [group]: { ...content[group], [key]: value } };
}

// 직원별 동의 여부·날짜 표시 (사용자 관리 표의 한 칸).
export function ConsentBadge({ consent, currentLabel }) {
  if (!consent) return <Badge tone="warning">미동의</Badge>;
  if (!consent.current)
    return (
      <span title={`v${consent.version} · ${when(consent.agreedAt)} 동의`}>
        <Badge tone="warning">이전 버전 동의</Badge>
      </span>
    );
  return (
    <span className="text-xs text-theme-text-secondary tabular-nums">
      <Badge tone="ok">동의</Badge> {currentLabel?.split(" · ")[0]} ·{" "}
      {when(consent.agreedAt)}
    </span>
  );
}

// 개인정보 동의서: 현재 문구·동의 현황·지난 버전. 고치면 새 버전으로 게시되고
// 모든 직원과 관리자가 다시 동의해야 한다.
export default function ConsentDocument() {
  const [overview, setOverview] = useState(null);
  const [editing, setEditing] = useState(null); // content being edited
  const [confirming, setConfirming] = useState(false);
  const [viewing, setViewing] = useState(null); // past document
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const result = await SchatAccount.consentOverview();
    if (result?.success) setOverview(result);
    else setError(result?.error || "동의서를 불러오지 못했습니다.");
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function publish() {
    setBusy(true);
    const result = await SchatAccount.publishConsent({
      ...editing,
      baseVersion: overview.document.version,
    });
    setBusy(false);
    setConfirming(false);
    if (!result?.success)
      return setError(result?.error || "동의서를 게시하지 못했습니다.");
    showToast(
      `${result.document.label}을 게시했습니다. 관리자도 다시 동의해야 합니다.`,
      "success"
    );
    // 관리자 본인도 새 버전에 동의해야 하므로 동의 화면으로 이동한다.
    window.location.reload();
  }

  async function openVersion(version) {
    const result = await SchatAccount.consentVersion(version);
    if (result?.success) setViewing(result.document);
  }

  if (!overview)
    return (
      <Card title="개인정보 동의서">
        {error ? <Notice tone="warning">{error}</Notice> : <Loading />}
      </Card>
    );
  const doc = overview.document;
  const nextVersion = doc.version + 1;

  return (
    <Card
      title="개인정보 동의서"
      description="직원과 관리자는 처음 비밀번호를 만들 때나 다음 로그인 때 한 번 동의합니다. 문구를 고치면 새 버전이 되고 모두 다시 동의해야 합니다."
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="ok">현재 {doc.label}</Badge>
        <span className="text-theme-text-secondary" data-testid="consent-count">
          사용 중인 계정 {overview.activeUsers}명 중 {overview.agreedCurrent}명
          동의
        </span>
      </div>

      {!editing ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setEditing(JSON.parse(JSON.stringify(doc.content)));
            }}
          >
            문구 고치기
          </Button>
          <Button variant="secondary" onClick={() => setViewing(doc)}>
            현재 문구 보기
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-y-3" data-testid="consent-editor">
          <Notice tone="warning">
            저장하면 {`v${nextVersion}`}이 되고 모든 직원과 관리자가 다시
            동의해야 합니다. 오타만 고쳐도 버전이 올라갑니다.
          </Notice>
          {FIELDS.map(([path, label, rows]) => (
            <Field key={path} label={label} htmlFor={`consent-${path}`}>
              <textarea
                id={`consent-${path}`}
                rows={rows}
                className={`${inputClass} !h-auto`}
                value={read(editing, path)}
                onChange={(e) =>
                  setEditing((c) => write(c, path, e.target.value))
                }
              />
            </Field>
          ))}
          <Field label="동의서 전문 (전체 보기)" htmlFor="consent-fullText">
            <textarea
              id="consent-fullText"
              rows={12}
              className={`${inputClass} !h-auto`}
              value={editing.fullText || ""}
              onChange={(e) =>
                setEditing((c) => ({ ...c, fullText: e.target.value }))
              }
            />
          </Field>
          {error && (
            <Notice tone="warning">
              <span role="alert">{error}</span>
            </Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setConfirming(true)}>
              {`v${nextVersion}`}로 게시
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
            >
              취소
            </Button>
          </div>
        </div>
      )}

      <div>
        <p className="m-0 mb-1 text-xs font-semibold text-theme-text-secondary">
          지난 버전
        </p>
        <ul className="m-0 flex flex-wrap gap-2 p-0 list-none">
          {overview.history.map((h) => (
            <li key={h.version}>
              <button
                type="button"
                className="text-xs text-sky-700 underline"
                onClick={() => openVersion(h.version)}
              >
                {h.label} ({when(h.publishedAt)})
              </button>
            </li>
          ))}
        </ul>
      </div>

      {confirming && (
        <Modal
          isOpen
          onClose={busy ? undefined : () => setConfirming(false)}
          size="md"
        >
          <ModalHeader
            title={`동의서 v${nextVersion} 게시`}
            onClose={busy ? undefined : () => setConfirming(false)}
          />
          <ModalBody>
            <p className="text-sm text-theme-text-primary">
              게시하면 모든 직원과 관리자가 다음에 SCHAT을 열 때 새 동의서에
              다시 동의해야 합니다. 지난 문구와 동의 기록은 그대로 남습니다.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                취소
              </Button>
              <Button
                onClick={publish}
                disabled={busy}
                data-testid="consent-publish"
              >
                {busy ? "게시 중..." : "게시"}
              </Button>
            </div>
          </ModalBody>
        </Modal>
      )}

      {viewing && (
        <Modal isOpen onClose={() => setViewing(null)} size="lg">
          <ModalHeader
            title={`개인정보 동의서 ${viewing.label}`}
            onClose={() => setViewing(null)}
          />
          <ModalBody>
            <p className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm leading-6 text-theme-text-primary">
              {viewing.content?.fullText}
            </p>
          </ModalBody>
        </Modal>
      )}
    </Card>
  );
}
