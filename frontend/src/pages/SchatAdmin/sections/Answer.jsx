import { useEffect, useState } from "react";
import System from "@/models/system";
import Workspace from "@/models/workspace";
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
import { promptInheritance } from "../promptInheritance";

export default function AnswerSection({ workspace, reload }) {
  return (
    <div className="flex flex-col gap-y-5">
      <HistoryCount workspace={workspace} onSaved={reload} />
      <AnswerRules workspace={workspace} onSaved={reload} />
      <Advanced workspace={workspace} onSaved={reload} />
    </div>
  );
}

function HistoryCount({ workspace, onSaved }) {
  const [value, setValue] = useState(workspace?.openAiHistory ?? 20);
  const [saving, setSaving] = useState(false);
  useEffect(
    () => setValue(workspace?.openAiHistory ?? 20),
    [workspace?.openAiHistory]
  );

  async function save(e) {
    e.preventDefault();
    const next = Number(value);
    if (!Number.isInteger(next) || next < 1 || next > 100)
      return showToast("1에서 100 사이의 숫자를 입력해 주세요.", "error");
    setSaving(true);
    const { workspace: updated } = await Workspace.update(workspace.slug, {
      openAiHistory: next,
    });
    setSaving(false);
    if (!updated) return showToast("저장하지 못했습니다.", "error");
    showToast("이전 대화 참고 수를 저장했습니다.", "success");
    onSaved?.();
  }

  return (
    <Card
      title="이전 대화 참고 수"
      description="같은 대화 안에서 최근 몇 개의 질문·답변을 함께 참고해 답할지 정합니다."
    >
      {!workspace ? (
        <Loading />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-y-3">
          <Field
            label="참고할 이전 대화 수"
            htmlFor="schat-history-count"
            help="기본값은 20입니다. 숫자가 크면 긴 대화의 흐름을 더 잘 따라가지만 답변이 느려질 수 있습니다."
          >
            <input
              id="schat-history-count"
              type="number"
              min={1}
              max={100}
              step={1}
              className={`${inputClass} max-w-[160px]`}
              value={value}
              onWheel={(e) => e.currentTarget.blur()}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <div>
            <Button
              type="submit"
              disabled={saving || Number(value) === workspace.openAiHistory}
            >
              {saving ? "저장 중..." : "저장"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function AnswerRules({ workspace, onSaved }) {
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);

  useEffect(() => {
    System.fetchDefaultSystemPrompt().then(({ defaultSystemPrompt }) => {
      setSaved(defaultSystemPrompt || "");
      setValue(defaultSystemPrompt || "");
      setLoaded(true);
    });
  }, []);

  async function save(e) {
    e.preventDefault();
    const next = value.trim();
    if (!next) return showToast("답변 규칙을 입력해 주세요.", "error");
    setSaving(true);
    const { success } = await System.updateDefaultSystemPrompt(next);
    setSaving(false);
    if (!success) return showToast("답변 규칙을 저장하지 못했습니다.", "error");
    setSaved(next);
    setValue(next);
    showToast("기본 답변 규칙을 저장했습니다.", "success");
  }

  async function switchToInherit() {
    setSwitching(true);
    const { workspace: updated } = await Workspace.update(workspace.slug, {
      openAiPrompt: null,
    });
    setSwitching(false);
    setConfirmSwitch(false);
    if (!updated) return showToast("전환하지 못했습니다.", "error");
    showToast("작업 공간이 기본 답변 규칙을 그대로 사용합니다.", "success");
    onSaved?.();
  }

  const inheritance = promptInheritance(workspace, saved);
  return (
    <Card
      title="SCHAT 기본 답변 규칙"
      description="AI가 답변할 때 따르는 기본 규칙입니다. 작업 공간은 이 규칙을 그대로 이어받아 사용합니다."
    >
      {!loaded || !workspace ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-theme-text-secondary">
              현재 작업 공간
            </span>
            {inheritance.inherits ? (
              <Badge tone="ok">기본 답변 규칙 사용 중</Badge>
            ) : (
              <Badge tone="warning">
                {inheritance.sameAsDefault
                  ? "같은 내용의 별도 규칙이 따로 저장됨"
                  : "기본과 다른 별도 규칙 사용 중"}
              </Badge>
            )}
          </div>
          {!inheritance.inherits && (
            <Notice tone="warning">
              <p className="mb-2">
                {inheritance.sameAsDefault
                  ? "작업 공간에 기본 답변 규칙과 같은 내용이 따로 한 번 더 저장되어 있습니다. 기본 규칙을 고쳐도 이 복사본은 바뀌지 않으므로, 기본 답변 규칙을 그대로 쓰도록 전환하는 것을 권장합니다. 전환해도 지금 답변 내용은 달라지지 않습니다."
                  : "작업 공간에 기본과 다른 별도 규칙이 저장되어 있습니다. 전환하면 작업 공간의 별도 규칙 대신 아래 기본 답변 규칙이 적용됩니다."}
              </p>
              {confirmSwitch ? (
                <div className="flex gap-x-2">
                  <Button onClick={switchToInherit} disabled={switching}>
                    {switching ? "전환 중..." : "전환"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setConfirmSwitch(false)}
                  >
                    취소
                  </Button>
                </div>
              ) : (
                <Button onClick={() => setConfirmSwitch(true)}>
                  기본 답변 규칙 사용으로 전환
                </Button>
              )}
            </Notice>
          )}
          <form onSubmit={save} className="flex flex-col gap-y-3">
            <Field
              label="기본 답변 규칙"
              htmlFor="schat-answer-rules"
              help="저장하면 기본 답변 규칙을 사용하는 모든 작업 공간에 바로 적용됩니다."
            >
              <textarea
                id="schat-answer-rules"
                rows={14}
                className={`${inputClass} font-normal leading-6 resize-y min-h-[220px]`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <Notice tone="warning">
              이 규칙은 직원 질문에 답하는 AI가 매번 따르는 기본 지시문입니다.
              저장하면 모든 직원 답변의 말투·범위·형식이 바로 달라질 수
              있으므로, 바꾸기 전에 내용을 꼭 확인해 주세요. 병원 문서 검색과
              출처 표시 기능은 이 규칙과 별도로 동작합니다.
            </Notice>
            <div className="flex gap-x-2">
              <Button
                type="submit"
                disabled={saving || value.trim() === saved.trim()}
              >
                {saving ? "저장 중..." : "저장"}
              </Button>
              <Button
                variant="secondary"
                disabled={value === saved}
                onClick={() => setValue(saved)}
              >
                되돌리기
              </Button>
            </div>
          </form>
        </div>
      )}
    </Card>
  );
}

function parseTemperature(value) {
  if (String(value).trim() === "") return null;
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 && next <= 2 ? next : null;
}

export function Advanced({ workspace, onSaved }) {
  const current = workspace?.openAiTemp ?? 0.7;
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(current), [workspace?.slug, current]);
  const next = parseTemperature(value);

  async function save(e) {
    e.preventDefault();
    if (next === null)
      return showToast("0에서 2 사이의 숫자를 입력해 주세요.", "error");
    setSaving(true);
    let updated;
    try {
      ({ workspace: updated } = await Workspace.update(workspace.slug, {
        openAiTemp: next,
      }));
    } catch {
      return showToast("저장하지 못했습니다.", "error");
    } finally {
      setSaving(false);
    }
    if (!updated) return showToast("저장하지 못했습니다.", "error");
    showToast("답변 표현 다양성을 저장했습니다.", "success");
    onSaved?.();
  }

  return (
    <details className="schat-admin-card rounded-xl p-5 group">
      <summary className="cursor-pointer text-base font-semibold text-theme-text-primary">
        고급 설정
      </summary>
      {!workspace ? (
        <Loading />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-y-3 mt-4">
          <InfoRow label="현재 적용 값(답변 표현 다양성)">{current}</InfoRow>
          <Field
            label="답변 표현 다양성"
            htmlFor="schat-answer-temperature"
            help="0에서 2 사이의 숫자를 입력합니다. AI가 표현을 고르는 방식에 영향을 줍니다. 값을 낮춰도 반드시 더 정확하거나 같은 답변이 되는 것은 아닙니다. 기존 값은 자동으로 바뀌지 않습니다."
          >
            <input
              id="schat-answer-temperature"
              type="number"
              min={0}
              max={2}
              step="any"
              className={`${inputClass} max-w-[160px]`}
              value={value}
              onWheel={(e) => e.currentTarget.blur()}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <p className="text-xs text-theme-text-secondary">보통은 바꿀 필요 없어요 (권장 0.7~1.0)</p>
          <div>
            <Button
              type="submit"
              disabled={saving || next === null || next === Number(current)}
            >
              {saving ? "저장 중..." : "저장"}
            </Button>
          </div>
        </form>
      )}
    </details>
  );
}
