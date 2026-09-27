import { useEffect, useState } from "react";
import System from "@/models/system";
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

const MODEL_NAMES = { "gemini-embedding-2": "Gemini Embedding 2" };
const PROVIDER_NAMES = { gemini: "Google Gemini" };

// Existing secret storage: the key goes to the server's update-env endpoint
// exactly like the upstream settings screen. It is never shown again.
const TARGETS = {
  llm: {
    title: "AI 답변",
    description: "직원 질문에 답변을 만드는 AI 서비스 연결입니다.",
    keyLabel: "AI 답변용 API 키",
    envField: "GeminiLLMApiKey",
  },
  embedding: {
    title: "검색 임베딩",
    description:
      "등록된 문서에서 질문과 관련된 내용을 찾는 데 쓰는 서비스 연결입니다.",
    keyLabel: "검색 임베딩용 API 키",
    envField: "GeminiEmbeddingApiKey",
  },
};

export default function ConnectionsSection() {
  const [state, setState] = useState(null);

  async function load() {
    const status = await SchatAdmin.status();
    setState(status?.connections || { error: true });
  }
  useEffect(() => {
    load();
  }, []);

  if (!state) return <Loading />;
  if (state.error)
    return <Notice tone="warning">연결 상태를 불러오지 못했습니다.</Notice>;
  return (
    <div className="flex flex-col gap-y-5">
      <Notice>
        API 키는 AI 서비스 연결에 사용하는 인증 키입니다. 보안을 위해 저장된
        키는 화면에 다시 표시하지 않으며, 새 키를 입력하면 기존 키가 교체됩니다.
        {state.sharedKey &&
          " 현재 AI 답변과 검색 임베딩이 같은 키를 사용하고 있습니다. 한쪽만 바꾸면 다른 쪽은 기존 키를 계속 사용합니다."}
      </Notice>
      {Object.keys(TARGETS).map((target) => (
        <ConnectionCard
          key={target}
          target={target}
          info={state[target]}
          onSaved={load}
        />
      ))}
    </div>
  );
}

function ConnectionCard({ target, info, onSaved }) {
  const config = TARGETS[target];
  const [editing, setEditing] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  function closeEditor() {
    setEditing(false);
    setConfirming(false);
    setNewKey("");
  }

  async function saveKey() {
    setSaving(true);
    const { error } = await System.updateSystem({
      [config.envField]: newKey.trim(),
    });
    setSaving(false);
    closeEditor();
    if (error) return showToast("API 키를 바꾸지 못했습니다.", "error");
    setResult(null);
    showToast("API 키를 바꿨습니다. 연결 테스트로 확인해 주세요.", "success");
    onSaved();
  }

  async function test() {
    setTesting(true);
    setResult(await SchatAdmin.connectionTest(target));
    setTesting(false);
  }

  const modelName = MODEL_NAMES[info?.model]
    ? `${MODEL_NAMES[info.model]} (${info.model})`
    : info?.model || "설정 안 됨";
  return (
    <Card title={config.title} description={config.description}>
      <div>
        <InfoRow label="제공 서비스">
          {PROVIDER_NAMES[info?.provider] || info?.provider || "설정 안 됨"}
        </InfoRow>
        <InfoRow label="API 키 상태">
          {info?.keySet ? (
            <Badge tone="ok">등록됨</Badge>
          ) : (
            <Badge tone="warning">미등록</Badge>
          )}
        </InfoRow>
        <InfoRow label="현재 모델">{modelName}</InfoRow>
      </div>
      {target === "embedding" && (
        <p className="text-xs leading-5 text-theme-text-secondary">
          검색 임베딩 모델을 바꾸면 모든 문서의 검색 데이터를 다시 만들어야
          하므로 이 화면에서는 모델을 바꾸지 않습니다. 새 API 키는 같은 모델을
          사용할 수 있는 키여야 합니다.
        </p>
      )}
      {editing ? (
        <div className="flex flex-col gap-y-3">
          <Field
            label={`새 ${config.keyLabel}`}
            htmlFor={`schat-key-${target}`}
            help="입력한 키는 저장 후 화면에 다시 표시되지 않습니다."
          >
            <input
              id={`schat-key-${target}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} max-w-[420px]`}
              value={newKey}
              onChange={(e) => {
                setNewKey(e.target.value);
                setConfirming(false);
              }}
            />
          </Field>
          {confirming ? (
            <Notice tone="warning">
              <p className="mb-2">
                {config.title} API 키를 새 키로 바꿀까요? 저장하는 즉시 모든
                직원 질문에 적용됩니다.
              </p>
              <div className="flex gap-x-2">
                <Button onClick={saveKey} disabled={saving}>
                  {saving ? "저장 중..." : "키 저장"}
                </Button>
                <Button variant="secondary" onClick={closeEditor}>
                  취소
                </Button>
              </div>
            </Notice>
          ) : (
            <div className="flex gap-x-2">
              <Button
                disabled={newKey.trim().length < 10}
                onClick={() => setConfirming(true)}
              >
                키 저장
              </Button>
              <Button variant="secondary" onClick={closeEditor}>
                취소
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            키 변경
          </Button>
          <Button
            variant="secondary"
            onClick={test}
            disabled={testing || !info?.keySet}
          >
            {testing ? "확인 중..." : "연결 테스트"}
          </Button>
          {result && (
            <Badge tone={result.ok ? "ok" : "warning"}>{result.message}</Badge>
          )}
        </div>
      )}
      <p className="text-xs leading-5 text-theme-text-secondary">
        연결 테스트는 저장된 키로 모델 정보만 조회합니다. 병원 문서나 질문
        내용은 보내지 않습니다.
      </p>
    </Card>
  );
}
