import { useEffect, useState } from "react";
import PasswordInput from "@/components/lib/PasswordInput";
import SchatAccount from "@/models/schatAccount";
import paths from "@/utils/paths";
import { AUTH_TOKEN, AUTH_USER } from "@/utils/constants";

const inputClass =
  "border-none bg-zinc-800 light:bg-slate-200 text-zinc-200 light:text-zinc-600 text-sm rounded-lg p-2.5 w-full h-[38px] focus:outline-none focus:ring-1 focus:ring-sky-300";
const labelClass =
  "flex flex-col gap-y-1.5 text-zinc-300 light:text-slate-800 text-sm";

function startSession(result) {
  window.localStorage.setItem(AUTH_USER, JSON.stringify(result.user));
  window.localStorage.setItem(AUTH_TOKEN, result.token);
  window.location = paths.home();
}

// Staff sign in with department + employee number + name + password. Every
// failure shows the same message; the server never says which part was wrong.
// An employee without a password yet (new, or reset by an admin) is sent to
// 처음 로그인 and chooses their own password there.
export default function EmployeeLoginForm({ appName = "SCHAT", onLegacy }) {
  const [departments, setDepartments] = useState(null);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [firstLogin, setFirstLogin] = useState(null); // {department, employeeNumber, name}
  const [creating, setCreating] = useState(false); // 비밀번호 만들기 step 1

  useEffect(() => {
    SchatAccount.loginOptions().then((result) => {
      setDepartments(result?.departments || []);
      setLegacyAvailable(!!result?.legacyLoginAvailable);
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.target);
    const identity = {
      department: form.get("department"),
      employeeNumber: form.get("employeeNumber"),
      name: form.get("name"),
    };
    const result = await SchatAccount.employeeLogin({
      ...identity,
      password: form.get("password"),
    });
    setLoading(false);
    if (result?.valid && result.token && result.user)
      return startSession(result);
    if (result?.firstLoginRequired) return setFirstLogin(identity);
    setError(result?.message || "로그인 정보를 다시 확인해주세요.");
  }

  if (firstLogin)
    return (
      <FirstLoginForm
        identity={firstLogin}
        onBack={() => {
          setFirstLogin(null);
          setCreating(false);
        }}
      />
    );
  if (creating)
    return (
      <CreatePasswordStart
        departments={departments}
        onVerified={setFirstLogin}
        onBack={() => setCreating(false)}
      />
    );

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col justify-center items-center w-full"
      aria-label="직원 로그인"
    >
      <p className="text-zinc-400 light:text-zinc-600 text-sm text-center pt-2 pb-6">
        {appName}에 로그인하세요.
      </p>
      <div className="w-full max-w-[300px] flex flex-col gap-y-3">
        <IdentityFields departments={departments} />
        <div className={labelClass}>
          <label htmlFor="schat-employee-password">비밀번호</label>
          <PasswordInput
            id="schat-employee-password"
            name="password"
            containerClassName="w-full"
            className={inputClass}
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="self-start text-xs text-sky-400 light:text-sky-700 underline"
          >
            처음 사용하시나요? 비밀번호 만들기
          </button>
        </div>
        {error && (
          <p role="alert" className="text-red-500 text-sm">
            {error}
          </p>
        )}
        <button
          disabled={loading}
          type="submit"
          className="mt-4 text-sm font-semibold rounded-lg h-[38px] w-full"
        >
          {loading ? "확인 중..." : "로그인"}
        </button>
        <p className="text-xs text-zinc-400 light:text-slate-500 text-center">
          비밀번호를 잊으셨다면 관리자에게 초기화를 요청한 뒤 비밀번호 만들기를
          다시 진행해 주세요.
        </p>
        {legacyAvailable && (
          <button
            type="button"
            onClick={onLegacy}
            className="text-xs text-zinc-400 light:text-slate-500 underline"
          >
            사번이 등록되지 않은 기존 계정으로 로그인
          </button>
        )}
      </div>
    </form>
  );
}

function IdentityFields({ departments }) {
  return (
    <>
      <label className={labelClass}>
        부서
        <select
          name="department"
          required
          defaultValue=""
          className={inputClass}
          disabled={departments === null}
        >
          <option value="" disabled>
            {departments === null ? "불러오는 중..." : "부서를 선택하세요"}
          </option>
          {(departments || []).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        사번
        <input
          name="employeeNumber"
          type="text"
          required
          autoComplete="username"
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        이름
        <input
          name="name"
          type="text"
          required
          autoComplete="name"
          className={inputClass}
        />
      </label>
    </>
  );
}

// 비밀번호 만들기, step 1: confirm the employee before asking for a password.
function CreatePasswordStart({ departments, onVerified, onBack }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setChecking(true);
    const form = new FormData(e.target);
    const identity = {
      department: form.get("department"),
      employeeNumber: form.get("employeeNumber"),
      name: form.get("name"),
    };
    const result = await SchatAccount.firstLoginCheck(identity);
    setChecking(false);
    if (result?.ok) return onVerified(identity);
    setError(result?.message || "로그인 정보를 다시 확인해주세요.");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col justify-center items-center w-full"
      aria-label="비밀번호 만들기"
    >
      <p className="text-zinc-300 light:text-slate-800 text-base font-semibold pt-2">
        비밀번호 만들기
      </p>
      <p className="text-zinc-400 light:text-zinc-600 text-sm text-center pt-1 pb-5 max-w-[300px]">
        등록된 직원인지 확인한 뒤 앞으로 사용할 비밀번호를 직접 만듭니다.
      </p>
      <div className="w-full max-w-[300px] flex flex-col gap-y-3">
        <IdentityFields departments={departments} />
        {error && (
          <p role="alert" className="text-red-500 text-sm">
            {error}
          </p>
        )}
        <button
          disabled={checking}
          type="submit"
          className="mt-2 text-sm font-semibold rounded-lg h-[38px] w-full"
        >
          {checking ? "확인 중..." : "다음"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-zinc-400 light:text-slate-500 underline"
        >
          로그인 화면으로 돌아가기
        </button>
      </div>
    </form>
  );
}

function FirstLoginForm({ identity, onBack }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.target);
    if (form.get("newPassword") !== form.get("confirmPassword"))
      return setError("새 비밀번호가 서로 다릅니다.");
    setSaving(true);
    const result = await SchatAccount.firstLogin({
      ...identity,
      newPassword: form.get("newPassword"),
      confirmPassword: form.get("confirmPassword"),
    });
    setSaving(false);
    if (result?.valid && result.token && result.user)
      return startSession(result);
    setError(result?.message || "로그인 정보를 다시 확인해주세요.");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col justify-center items-center w-full"
      aria-label="처음 로그인"
    >
      <p className="text-zinc-300 light:text-slate-800 text-base font-semibold pt-2">
        비밀번호 만들기
      </p>
      <p className="text-zinc-400 light:text-zinc-600 text-sm text-center pt-1 pb-5 max-w-[300px]">
        {identity.department} · {identity.name}님, 앞으로 사용할 비밀번호를 직접
        정해 주세요.
      </p>
      <div className="w-full max-w-[300px] flex flex-col gap-y-3">
        <div className={labelClass}>
          <label htmlFor="schat-first-password">새 비밀번호</label>
          <PasswordInput
            id="schat-first-password"
            name="newPassword"
            containerClassName="w-full"
            className={inputClass}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className={labelClass}>
          <label htmlFor="schat-first-password-confirm">새 비밀번호 확인</label>
          <PasswordInput
            id="schat-first-password-confirm"
            name="confirmPassword"
            containerClassName="w-full"
            className={inputClass}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <p className="text-xs text-zinc-400 light:text-slate-500">
          8자 이상, 영문·숫자·특수문자 중 두 가지 이상을 섞어 주세요. 사번이
          들어간 비밀번호는 쓸 수 없습니다.
        </p>
        {error && (
          <p role="alert" className="text-red-500 text-sm">
            {error}
          </p>
        )}
        <button
          disabled={saving}
          type="submit"
          className="mt-2 text-sm font-semibold rounded-lg h-[38px] w-full"
        >
          {saving ? "만드는 중..." : "비밀번호 만들기"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-zinc-400 light:text-slate-500 underline"
        >
          로그인 화면으로 돌아가기
        </button>
      </div>
    </form>
  );
}
