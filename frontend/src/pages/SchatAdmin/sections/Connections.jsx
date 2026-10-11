import { useEffect, useRef, useState } from "react";
import SchatAdmin from "@/models/schatAdmin";
import showToast from "@/utils/toast";
import {
  Badge,
  Button,
  Card,
  Field,
  InfoRow,
  Loading,
  Notice,
  inputClass,
} from "../ui";

const TARGETS = {
  llm: {
    title: "AI 답변",
    description: "직원 질문에 답변을 만드는 AI 모델과 열쇠입니다.",
  },
  embedding: {
    title: "문서 검색 연결",
    description: "관련 문서를 찾는 AI 서비스의 열쇠입니다.",
  },
};

export default function ConnectionsSection({ onSaved }) {
  const [state, setState] = useState(null);
  async function load() {
    const result = await SchatAdmin.aiSettings();
    setState(result?.ok ? result : { error: true });
  }
  useEffect(() => {
    load();
  }, []);
  if (!state) return <Loading />;
  if (state.error)
    return <Notice tone="warning">AI 설정을 불러오지 못했습니다.</Notice>;
  return (
    <div className="flex flex-col gap-y-5">
      {state.connections.sharedKey && (
        <Notice>
          답변과 문서 검색이 같은 열쇠를 사용 중입니다. 한쪽만 바꾸면 다른 쪽은
          기존 열쇠를 계속 사용합니다.
        </Notice>
      )}
      {Object.keys(TARGETS).map((target) => (
        <ConnectionCard
          key={target}
          target={target}
          info={state.connections[target]}
          revision={state.revision}
          onSaved={() => {
            onSaved?.();
            load();
          }}
        />
      ))}
    </div>
  );
}

export function ConnectionCard({ target, info, revision, onSaved }) {
  const config = TARGETS[target];
  const answer = target === "llm";
  const [editing, setEditing] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [model, setModel] = useState(info?.model || "");
  const [models, setModels] = useState([]);
  const [listRevision, setListRevision] = useState(revision);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const busy = useRef(false);
  const listRequest = useRef(0);

  async function loadModels(key = newKey) {
    const request = ++listRequest.current;
    setLoading(true);
    setModels([]);
    setResult(null);
    try {
      const response = await SchatAdmin.aiModels({
        revision,
        ...(key.trim() ? { apiKey: key.trim() } : {}),
      });
      if (request !== listRequest.current) return;
      if (!response?.ok) {
        setResult(
          response || { ok: false, message: "모델 목록을 확인하지 못했습니다." }
        );
        return;
      }
      if (response.revision !== revision) {
        setResult({
          ok: false,
          message: "설정이 바뀌었습니다. 화면을 다시 열어 주세요.",
        });
        return;
      }
      setModels(response.models);
      setListRevision(response.revision);
      setModel((current) => (response.models.includes(current) ? current : ""));
    } catch {
      if (request === listRequest.current)
        setResult({ ok: false, message: "모델 목록을 확인하지 못했습니다." });
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }
  async function openEditor() {
    setEditing(true);
    setNewKey("");
    setModel(info?.model || "");
    setResult(null);
    setListRevision(revision);
    if (answer) await loadModels("");
  }
  function closeEditor() {
    ++listRequest.current;
    setEditing(false);
    setNewKey("");
    setModels([]);
    setLoading(false);
    setResult(null);
  }
  async function save(event) {
    event.preventDefault();
    if (busy.current || !model || (answer && !models.includes(model))) return;
    busy.current = true;
    setSaving(true);
    setResult(null);
    try {
      const response = await SchatAdmin.saveAiSettings({
        target,
        model,
        ...(newKey.trim() ? { apiKey: newKey.trim() } : {}),
        revision: listRevision,
      });
      if (!response?.ok) {
        setResult(
          response || {
            ok: false,
            message: "저장하지 못했습니다. 이전 설정을 유지합니다.",
          }
        );
        return;
      }
      closeEditor();
      showToast("연결을 확인하고 저장했습니다.", "success");
      onSaved?.();
    } catch {
      setResult({
        ok: false,
        message: "저장하지 못했습니다. 이전 설정을 유지합니다.",
      });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  async function test() {
    setTesting(true);
    try {
      setResult(await SchatAdmin.connectionTest(target));
    } finally {
      setTesting(false);
    }
  }
  const changed = model !== info?.model || !!newKey.trim();
  return (
    <Card
      title={config.title}
      description={config.description}
      help={[
        "모델과 열쇠는 평소 바꿀 필요가 없어요.",
        "열쇠(API 키)는 Gemini에 연결하는 비밀번호 같은 값이에요.",
        "저장 전 새 열쇠로 모델 정보만 확인해요. 병원 문서·질문은 보내지 않아요.",
      ]}
    >
      <Notice tone="warning">
        거의 안 씀. 변경하면 직원 답변이나 문서 검색에 바로 영향을 줍니다.
      </Notice>
      <div>
        <InfoRow label="제공 서비스">
          {info?.provider === "gemini"
            ? "Google Gemini"
            : info?.provider || "설정 안 됨"}
        </InfoRow>
        <InfoRow label="열쇠 상태">
          <Badge tone={info?.keySet ? "ok" : "warning"}>
            {info?.keySet ? "등록됨" : "미등록"}
          </Badge>
        </InfoRow>
        <InfoRow label="현재 모델">{info?.model || "설정 안 됨"}</InfoRow>
      </div>
      {!answer && (
        <p className="text-xs leading-5 text-theme-text-secondary">
          검색 모델을 바꾸려면 문서 검색 자료를 다시 만들어야 하므로 여기서는
          열쇠만 바꿉니다.
        </p>
      )}
      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-y-3">
          <Field
            label={`새 ${answer ? "답변용" : "검색용"} Gemini 열쇠`}
            htmlFor={`schat-key-${target}`}
            help="비워 두면 기존 열쇠를 유지합니다. 저장된 열쇠는 화면에 다시 표시하지 않습니다."
          >
            <input
              id={`schat-key-${target}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={saving}
              className={`${inputClass} max-w-[420px]`}
              value={newKey}
              onChange={(event) => {
                setNewKey(event.target.value);
                setResult(null);
                if (answer) {
                  ++listRequest.current;
                  setModels([]);
                  setLoading(false);
                }
              }}
            />
          </Field>
          {answer && (
            <>
              <Field
                label="사용 AI 모델"
                htmlFor="schat-answer-model"
                help="이 열쇠로 사용할 수 있고 답변 생성을 지원하는 Gemini 모델만 표시합니다."
              >
                <select
                  id="schat-answer-model"
                  className={`${inputClass} max-w-[420px]`}
                  value={model}
                  disabled={saving || loading || !models.length}
                  onChange={(event) => setModel(event.target.value)}
                >
                  <option value="">모델을 선택해 주세요</option>
                  {models.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <div>
                <Button
                  variant="secondary"
                  disabled={saving || loading}
                  onClick={() => loadModels()}
                >
                  {loading ? "목록 확인 중..." : "모델 목록 확인"}
                </Button>
              </div>
            </>
          )}
          <div className="flex gap-x-2">
            <Button
              type="submit"
              disabled={
                saving ||
                loading ||
                !changed ||
                !model ||
                (answer && !models.includes(model))
              }
            >
              {saving ? "연결 확인·저장 중..." : "연결 확인 후 저장"}
            </Button>
            <Button variant="secondary" disabled={saving} onClick={closeEditor}>
              취소
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={info?.provider !== "gemini"}
            onClick={openEditor}
          >
            {answer ? "모델·열쇠 변경" : "열쇠 변경"}
          </Button>
          <Button
            variant="secondary"
            disabled={testing || !info?.keySet}
            onClick={test}
          >
            {testing ? "확인 중..." : "연결 확인"}
          </Button>
        </div>
      )}
      {result && (
        <Notice tone={result.ok ? "info" : "warning"}>{result.message}</Notice>
      )}
    </Card>
  );
}
