import { useEffect, useState, useSyncExternalStore } from "react";
import Admin from "@/models/admin";
import System from "@/models/system";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";
import SchLogo from "@/components/SchLogo";
import { REFETCH_WORKSPACES_EVENT } from "@/components/Sidebar/ActiveWorkspaces";
import { Button, Card, Field, Loading, inputClass } from "../ui";
import { createBrandEditor } from "../brandController";
import Brand from "@/models/schatBrand";
import { fromKoreaInput, toKoreaInput } from "@/utils/schatBrand";

export default function BrandSection({ workspace, reloadAll }) {
  return (
    <div className="flex flex-col gap-y-5">
      <ServiceName />
      <WorkspaceName workspace={workspace} onSaved={reloadAll} />
      <BrandSettings />
    </div>
  );
}

function ServiceName() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    System.fetchCustomAppName().then(({ appName }) => {
      setValue(appName || "");
      setSaved(appName || "");
      setLoading(false);
    });
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const next = value.trim();
    const { success } = await Admin.updateSystemPreferences({
      custom_app_name: next,
    });
    setSaving(false);
    if (!success)
      return showToast("서비스 이름을 저장하지 못했습니다.", "error");
    window.localStorage.removeItem(System.cacheKeys.customAppName);
    setSaved(next);
    showToast("서비스 이름을 저장했습니다.", "success");
  }

  return (
    <Card
      title="서비스 이름"
      description="로그인 화면의 '○○에 로그인하세요.' 문구에 표시되는 이름입니다. 비워 두면 SCHAT으로 표시됩니다."
    >
      {loading ? (
        <Loading />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-y-3">
          <Field label="서비스 이름" htmlFor="schat-service-name">
            <input
              id="schat-service-name"
              className={`${inputClass} max-w-[360px]`}
              value={value}
              maxLength={40}
              placeholder="SCHAT"
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" disabled={saving || value.trim() === saved}>
              {saving ? "저장 중..." : "저장"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function WorkspaceName({ workspace, onSaved }) {
  const [value, setValue] = useState(workspace?.name || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(workspace?.name || ""), [workspace?.name]);

  async function save(e) {
    e.preventDefault();
    const next = value.trim();
    if (!next) return showToast("작업 공간 이름을 입력해 주세요.", "error");
    setSaving(true);
    const { workspace: updated } = await Workspace.update(workspace.slug, {
      name: next,
    });
    setSaving(false);
    if (!updated)
      return showToast("작업 공간 이름을 저장하지 못했습니다.", "error");
    window.dispatchEvent(new CustomEvent(REFETCH_WORKSPACES_EVENT));
    await onSaved?.();
    showToast("작업 공간 이름을 저장했습니다.", "success");
  }

  return (
    <Card
      title="작업 공간 이름"
      description="직원 화면 왼쪽 목록에 보이는 작업 공간(워크스페이스) 이름입니다. 주소(링크)는 바뀌지 않습니다."
    >
      {!workspace ? (
        <Loading />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-y-3">
          <Field label="작업 공간 이름" htmlFor="schat-workspace-name">
            <input
              id="schat-workspace-name"
              className={`${inputClass} max-w-[360px]`}
              value={value}
              maxLength={80}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <div>
            <Button
              type="submit"
              disabled={saving || value.trim() === workspace.name}
            >
              {saving ? "저장 중..." : "저장"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function BrandSettings() {
  const [controller] = useState(() => createBrandEditor(Brand));
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useEffect(() => {
    controller.start();
  }, [controller]);
  return <BrandEditorView controller={controller} state={state} />;
}

export function BrandEditorView({ controller, state }) {
  if (state.loading) return <Loading />;
  if (!state.draft)
    return (
      <Card title="브랜드 설정">
        <p role="alert">{state.error}</p>
        <Button onClick={() => controller.start()}>다시 불러오기</Button>
      </Card>
    );
  const { draft } = state;
  const changeNotice = (key, value) =>
    controller.change("announcement", { ...draft.announcement, [key]: value });
  function actions(section) {
    return (
      <div className="flex gap-2">
        <Button type="submit" disabled={!!state.saving}>
          {state.saving === section ? "저장 중..." : "저장"}
        </Button>
        <Button
          variant="secondary"
          disabled={!!state.saving}
          onClick={() => controller.save(section, true)}
        >
          원래대로
        </Button>
      </div>
    );
  }
  const form = (section) => ({
    "data-brand-section": section,
    onSubmit: (event) => {
      event.preventDefault();
      return controller.save(section);
    },
    className: "flex flex-col gap-3",
  });
  return (
    <>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-theme-text-primary">
          {state.message}
        </p>
      )}
      <Card
        title="병원 로고"
        description="병원 로고를 바꾸고 저장 전에 미리 확인합니다."
        help="PNG·SVG 파일, 1MB 이하. 화면 크기에 자동으로 맞춥니다. SVG의 실행 기능·외부 참조·스타일 정의는 사용할 수 없습니다."
      >
        <form {...form("logo")}>
          <Field label="로고 파일" htmlFor="brand-logo">
            <input
              id="brand-logo"
              type="file"
              accept=".png,.svg,image/png,image/svg+xml"
              disabled={!!state.saving}
              onChange={(e) => {
                controller.chooseLogo(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </Field>
          <div className="schat-admin-brand-preview rounded-lg p-4">
            <p className="mb-3 text-xs text-theme-text-secondary">
              저장 전 미리보기
            </p>
            <SchLogo
              src={draft.logo}
              className="h-[32px] max-w-[240px] w-auto"
              alt="병원 로고 미리보기"
            />
          </div>
          {actions("logo")}
        </form>
      </Card>
      <Card
        title="로그인 부제목"
        description="로그인 화면에 표시되는 짧은 소개입니다."
        help="최대 80자까지 입력할 수 있습니다. 원래대로를 누르면 병원 실무지침 AI로 돌아갑니다."
      >
        <form {...form("subtitle")}>
          <Field label="로그인 부제목" htmlFor="brand-subtitle">
            <input
              id="brand-subtitle"
              className={inputClass}
              value={draft.subtitle}
              maxLength={80}
              required
              disabled={!!state.saving}
              onChange={(e) => controller.change("subtitle", e.target.value)}
            />
          </Field>
          {actions("subtitle")}
        </form>
      </Card>
      <Card
        title="직원 화면 공지"
        description="직원 화면 맨 위에 한 줄 공지를 표시합니다."
        help="시작·종료 일시는 한국 시간입니다. 비워 두면 해당 시간 제한이 없습니다. 켜진 공지는 열린 화면에서도 종료 일시에 숨겨집니다."
      >
        <form {...form("announcement")}>
          <label className="flex items-center gap-2 text-sm text-theme-text-primary">
            <input
              id="brand-notice-enabled"
              type="checkbox"
              checked={draft.announcement.enabled}
              disabled={!!state.saving}
              onChange={(e) => changeNotice("enabled", e.target.checked)}
            />
            공지 켜기
          </label>
          <Field label="공지 내용" htmlFor="brand-notice">
            <input
              id="brand-notice"
              className={inputClass}
              maxLength={200}
              value={draft.announcement.text}
              required={draft.announcement.enabled}
              disabled={!!state.saving}
              onChange={(e) =>
                changeNotice("text", e.target.value.replace(/[\r\n]/g, " "))
              }
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[
              ["start", "시작 일시 (한국 시간)"],
              ["end", "종료 일시 (한국 시간)"],
            ].map(([key, label]) => (
              <Field key={key} label={label} htmlFor={`brand-notice-${key}`}>
                <input
                  id={`brand-notice-${key}`}
                  type="datetime-local"
                  className={inputClass}
                  value={toKoreaInput(draft.announcement[key])}
                  disabled={!!state.saving}
                  onChange={(e) =>
                    changeNotice(key, fromKoreaInput(e.target.value))
                  }
                />
              </Field>
            ))}
          </div>
          {actions("announcement")}
        </form>
      </Card>
      <Card
        title="새 대화 첫 화면"
        description="새 대화에 보이는 안내와 예시 질문을 바꿉니다."
        help="짧은 안내는 160자, 예시 질문은 한 줄에 하나씩 최대 5개·각 200자까지 입력합니다. 예시를 비우면 기존 작업 공간의 예시 질문을 사용합니다."
      >
        <form {...form("welcome")}>
          <Field label="짧은 안내" htmlFor="brand-welcome">
            <input
              id="brand-welcome"
              className={inputClass}
              maxLength={160}
              required
              value={draft.welcome.text}
              disabled={!!state.saving}
              onChange={(e) =>
                controller.change("welcome", {
                  ...draft.welcome,
                  text: e.target.value,
                })
              }
            />
          </Field>
          <Field label="예시 질문" htmlFor="brand-examples">
            <textarea
              id="brand-examples"
              className={inputClass}
              rows={5}
              maxLength={1004}
              value={draft.welcome.examples.join("\n")}
              disabled={!!state.saving}
              onChange={(e) =>
                controller.change("welcome", {
                  ...draft.welcome,
                  examples: e.target.value.split("\n"),
                })
              }
            />
          </Field>
          {actions("welcome")}
        </form>
      </Card>
    </>
  );
}
