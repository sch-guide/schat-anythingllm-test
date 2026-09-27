import { useEffect, useState } from "react";
import Admin from "@/models/admin";
import System from "@/models/system";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";
import SchLogo from "@/components/SchLogo";
import { REFETCH_WORKSPACES_EVENT } from "@/components/Sidebar/ActiveWorkspaces";
import { Button, Card, Field, Loading, inputClass } from "../ui";

export default function BrandSection({ workspace, reloadAll }) {
  return (
    <div className="flex flex-col gap-y-5">
      <ServiceName />
      <WorkspaceName workspace={workspace} onSaved={reloadAll} />
      <LogoPreview />
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

function LogoPreview() {
  return (
    <Card
      title="병원 로고와 로그인 화면"
      description="현재 적용된 순천향대학교 부속 천안병원 로고와 로그인 화면 문구입니다. 로고 파일과 로그인 디자인은 화질 확인이 필요해 이 화면에서 바꾸지 않습니다. 교체가 필요하면 기술 담당자에게 요청해 주세요."
    >
      <div className="schat-admin-brand-preview rounded-lg p-4 flex flex-col gap-y-3">
        <div className="flex items-center gap-x-[9px]">
          <SchLogo className="h-[28px] w-auto" alt="SCH 로고" />
          <span className="text-sm font-semibold text-theme-text-primary">
            순천향대학교 부속 천안병원
          </span>
        </div>
        <div className="flex items-center gap-x-[10px]">
          <SchLogo className="h-[32px] w-auto" alt="SCH 로고" />
          <span className="text-sm font-semibold text-theme-text-primary">
            병원 실무지침 AI
          </span>
        </div>
      </div>
    </Card>
  );
}
