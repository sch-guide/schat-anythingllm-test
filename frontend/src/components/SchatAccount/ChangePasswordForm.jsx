import { useState } from "react";
import PasswordInput from "@/components/lib/PasswordInput";
import SchatAccount from "@/models/schatAccount";

const inputClass =
  "schat-admin-input w-full rounded-lg px-3 h-[38px] text-sm outline-none bg-theme-settings-input-bg text-theme-text-primary border border-theme-sidebar-border focus:border-sky-500";

// "비밀번호 변경" in the user menu.
// Password values live only in the form fields, never in React state.
export default function ChangePasswordForm({ onDone }) {
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.target);
    if (form.get("newPassword") !== form.get("confirmPassword"))
      return setError("새 비밀번호가 서로 다릅니다.");
    setSaving(true);
    const result = await SchatAccount.changePassword({
      currentPassword: form.get("currentPassword"),
      newPassword: form.get("newPassword"),
      confirmPassword: form.get("confirmPassword"),
    });
    setSaving(false);
    if (!result.success)
      return setError(result.error || "변경하지 못했습니다.");
    e.target.reset();
    onDone?.(result.user);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-y-3">
      <label className="flex flex-col gap-y-1.5 text-sm text-theme-text-primary">
        현재 비밀번호
        <PasswordInput
          name="currentPassword"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-y-1.5 text-sm text-theme-text-primary">
        새 비밀번호
        <PasswordInput
          name="newPassword"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-y-1.5 text-sm text-theme-text-primary">
        새 비밀번호 확인
        <PasswordInput
          name="confirmPassword"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      <p className="text-xs text-theme-text-secondary">
        8자 이상, 영문·숫자·특수문자 중 두 가지 이상을 섞어 주세요. 사번이
        들어간 비밀번호는 쓸 수 없습니다.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={saving}
        className="schat-admin-button schat-admin-button--primary rounded-lg h-[38px] text-sm font-medium disabled:opacity-50"
      >
        {saving ? "변경 중..." : "비밀번호 변경"}
      </button>
    </form>
  );
}
