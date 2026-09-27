import { useCallback, useEffect, useState } from "react";
import SchatAccount from "@/models/schatAccount";
import useUser from "@/hooks/useUser";
import showToast from "@/utils/toast";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import { Badge, Button, Card, Field, Loading, inputClass } from "../ui";
import BulkImport from "./UsersBulk";
import Departments from "./UsersDepartments";
import DeleteAccountsDialog from "./UsersDelete";

// SCHAT uses two roles only. The server's "manager" role still exists, so an
// account that already has it is shown as-is and can be moved to one of these.
export const ROLE_LABELS = {
  default: "일반사용자",
  admin: "관리자",
};
const LEGACY_ROLE_LABELS = { manager: "매니저(이전 역할)" };

export function roleOptions(currentRole) {
  const options = Object.entries(ROLE_LABELS);
  if (LEGACY_ROLE_LABELS[currentRole])
    options.push([currentRole, LEGACY_ROLE_LABELS[currentRole]]);
  return options;
}

const when = (iso) => (iso ? new Date(iso).toLocaleDateString("ko-KR") : "-");

export default function UsersSection() {
  const [panel, setPanel] = useState(null); // "add" | "bulk" | "departments"
  const [departments, setDepartments] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);

  const loadDepartments = useCallback(async () => {
    const result = await SchatAccount.departments();
    setDepartments(result?.departments || []);
  }, []);
  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const refresh = () => {
    loadDepartments();
    setReloadKey((k) => k + 1);
  };
  const toggle = (name) => setPanel((p) => (p === name ? null : name));

  return (
    <div className="flex flex-col gap-y-5">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={panel === "add" ? "primary" : "secondary"}
          onClick={() => toggle("add")}
        >
          직원 추가
        </Button>
        <Button
          variant={panel === "bulk" ? "primary" : "secondary"}
          onClick={() => toggle("bulk")}
        >
          직원 일괄등록
        </Button>
        <Button
          variant={panel === "departments" ? "primary" : "secondary"}
          onClick={() => toggle("departments")}
        >
          부서 관리
        </Button>
      </div>
      {panel === "add" && (
        <AddEmployee departments={departments} onAdded={refresh} />
      )}
      {panel === "bulk" && <BulkImport onDone={refresh} />}
      {panel === "departments" && (
        <Departments departments={departments} onChanged={refresh} />
      )}
      <AccountList key={reloadKey} departments={departments} />
    </div>
  );
}

function AddEmployee({ departments, onAdded }) {
  const empty = {
    name: "",
    employeeNumber: "",
    departmentId: "",
    role: "default",
    active: true,
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const active = departments.filter((d) => d.active);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    const response = await SchatAccount.createAccount({
      ...form,
      departmentId: Number(form.departmentId),
    });
    setSaving(false);
    if (!response.success)
      return showToast(
        response.error || "직원을 추가하지 못했습니다.",
        "error"
      );
    showToast(
      `${response.user?.name} 직원을 추가했습니다. 직원이 처음 로그인할 때 비밀번호를 직접 정합니다.`,
      "success"
    );
    setForm(empty);
    onAdded();
  }

  const set = (key) => (e) =>
    setForm((prev) => ({
      ...prev,
      [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  return (
    <Card
      title="직원 추가"
      description="비밀번호는 만들지 않습니다. 직원이 로그인 화면에서 부서·사번·이름을 입력하면 처음 로그인 화면에서 비밀번호를 직접 정합니다."
    >
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="이름" htmlFor="schat-add-name">
          <input
            id="schat-add-name"
            required
            maxLength={50}
            className={inputClass}
            value={form.name}
            onChange={set("name")}
          />
        </Field>
        <Field
          label="사번"
          htmlFor="schat-add-number"
          help="영문·숫자·하이픈만 사용할 수 있습니다."
        >
          <input
            id="schat-add-number"
            required
            maxLength={30}
            className={inputClass}
            value={form.employeeNumber}
            onChange={set("employeeNumber")}
          />
        </Field>
        <Field label="부서" htmlFor="schat-add-dept">
          <select
            id="schat-add-dept"
            required
            className={inputClass}
            value={form.departmentId}
            onChange={set("departmentId")}
          >
            <option value="" disabled>
              {active.length ? "선택하세요" : "먼저 부서를 등록해 주세요"}
            </option>
            {active.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="권한" htmlFor="schat-add-role">
          <select
            id="schat-add-role"
            className={inputClass}
            value={form.role}
            onChange={set("role")}
          >
            {Object.entries(ROLE_LABELS).map(([role, label]) => (
              <option key={role} value={role}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <label className="inline-flex items-center gap-x-2 text-sm text-theme-text-primary">
          <input
            type="checkbox"
            className="h-4 w-4 accent-sky-600"
            checked={form.active}
            onChange={set("active")}
          />
          계정 사용
        </label>
        <div className="md:col-span-2">
          <Button type="submit" disabled={saving}>
            {saving ? "추가 중..." : "직원 추가"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AccountList({ departments }) {
  const { user: me } = useUser();
  const [filters, setFilters] = useState({
    q: "",
    departmentId: "",
    role: "",
    status: "",
  });
  const [users, setUsers] = useState(null);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState([]);
  const [deleting, setDeleting] = useState(null); // ids to delete

  const load = useCallback(async () => {
    const result = await SchatAccount.accounts(filters);
    const list = result?.users || [];
    setUsers(list);
    // keep only selections that are still visible after filtering
    setSelected((prev) => prev.filter((id) => list.some((u) => u.id === id)));
  }, [filters]);

  async function setActive(ids, active) {
    const result = await SchatAccount.bulkStatus(ids, active);
    if (!result.success)
      return showToast(result.error || "상태를 바꾸지 못했습니다.", "error");
    const verb = active ? "다시 사용" : "사용중지";
    showToast(
      result.failed?.length
        ? `${result.updated}명 ${verb}. ${result.failed.length}명은 바꿀 수 없습니다: ${result.failed[0].reason}`
        : `${result.updated}명을 ${verb}로 바꿨습니다.`,
      result.failed?.length ? "warning" : "success"
    );
    load();
  }

  const selectable = (users || []).filter((u) => u.id !== me?.id);
  const allSelected =
    selectable.length > 0 && selectable.every((u) => selected.includes(u.id));
  const toggleOne = (id) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const set = (key) => (e) =>
    setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Card
      title="직원 목록"
      description="직원 상태를 확인하고 수정에서 관리합니다. 사용중지·다시 사용·비밀번호 초기화·계정 삭제는 수정 화면에 있습니다. 퇴사·휴직은 사용중지를 권장합니다."
    >
      <div className="grid gap-3 md:grid-cols-4">
        <input
          aria-label="이름 또는 사번 검색"
          placeholder="이름 또는 사번 검색"
          className={inputClass}
          value={filters.q}
          onChange={set("q")}
        />
        <select
          aria-label="부서 필터"
          className={inputClass}
          value={filters.departmentId}
          onChange={set("departmentId")}
        >
          <option value="">전체 부서</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          aria-label="권한 필터"
          className={inputClass}
          value={filters.role}
          onChange={set("role")}
        >
          <option value="">전체 권한</option>
          {Object.entries(ROLE_LABELS).map(([role, label]) => (
            <option key={role} value={role}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="상태 필터"
          className={inputClass}
          value={filters.status}
          onChange={set("status")}
        >
          <option value="">전체 상태</option>
          <option value="active">사용중</option>
          <option value="inactive">사용중지</option>
        </select>
      </div>
      {selected.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-theme-sidebar-border px-3 py-2"
          data-testid="selection-bar"
        >
          <span className="text-sm text-theme-text-primary">
            선택 {selected.length}명
          </span>
          <Button
            variant="secondary"
            onClick={() => setActive(selected, false)}
          >
            사용중지
          </Button>
          <Button variant="secondary" onClick={() => setActive(selected, true)}>
            다시 사용
          </Button>
          <button
            type="button"
            onClick={() => setDeleting(selected)}
            className="text-xs text-red-500 underline ml-auto"
          >
            선택 사용자 삭제
          </button>
        </div>
      )}
      {!users ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto">
          {/* Cells never wrap; long names/departments are cut with an
              ellipsis (full text on hover) and narrow screens scroll. */}
          <table className="schat-user-table w-full min-w-[640px] text-sm text-left whitespace-nowrap">
            <thead className="text-xs text-theme-text-secondary border-b border-theme-sidebar-border">
              <tr>
                <th className="py-2 pr-2 w-8 font-medium">
                  <input
                    type="checkbox"
                    aria-label="보이는 직원 모두 선택"
                    className="h-4 w-4 accent-sky-600"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(
                        allSelected ? [] : selectable.map((u) => u.id)
                      )
                    }
                  />
                </th>
                <th className="py-2 pr-3 font-medium">이름</th>
                <th className="py-2 pr-3 font-medium">사번</th>
                <th className="py-2 pr-3 font-medium">부서</th>
                <th className="py-2 pr-3 font-medium">권한</th>
                <th className="py-2 pr-3 font-medium">상태</th>
                <th className="py-2 pr-3 font-medium">최근 로그인</th>
                <th className="schat-sticky-action py-2 pl-3 font-medium text-right">
                  작업
                </th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-theme-text-secondary">
                    조건에 맞는 직원이 없습니다.
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-theme-sidebar-border last:border-b-0"
                >
                  <td className="py-2.5 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`${u.name} 선택`}
                      className="h-4 w-4 accent-sky-600 disabled:opacity-30"
                      disabled={me?.id === u.id}
                      checked={selected.includes(u.id)}
                      onChange={() => toggleOne(u.id)}
                    />
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-primary font-medium">
                    <span className="inline-flex items-center gap-x-1.5 max-w-[160px]">
                      <span className="truncate" title={u.name}>
                        {u.name}
                      </span>
                      {me?.id === u.id && <Badge>나</Badge>}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-primary tabular-nums">
                    {u.employeeNumber || (
                      <span className="text-theme-text-secondary">미등록</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-primary">
                    <span
                      className="block max-w-[120px] truncate"
                      title={u.department || ""}
                    >
                      {u.department || "-"}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-primary">
                    {u.roleLabel}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="inline-flex items-center gap-1">
                      <Badge tone={u.active ? "ok" : "neutral"}>
                        {u.active ? "사용중" : "사용중지"}
                      </Badge>
                      {u.mustChangePassword && (
                        <Badge tone="warning">비밀번호 미설정</Badge>
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-theme-text-secondary tabular-nums">
                    {when(u.lastLoginAt)}
                  </td>
                  <td className="schat-sticky-action py-2.5 pl-3 text-right">
                    <Button
                      variant="secondary"
                      className="!px-2.5 !py-1 !text-xs"
                      onClick={() => setEditing(u)}
                    >
                      수정
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <EditAccount
          user={editing}
          departments={departments}
          isSelf={me?.id === editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onChanged={load}
          onDelete={() => {
            setDeleting([editing.id]);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <DeleteAccountsDialog
          ids={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            setSelected([]);
            load();
          }}
        />
      )}
    </Card>
  );
}

function EditAccount({
  user,
  departments,
  isSelf,
  onClose,
  onSaved,
  onChanged,
  onDelete,
}) {
  const [form, setForm] = useState({
    name: user.name || "",
    employeeNumber: user.employeeNumber || "",
    departmentId: user.departmentId || "",
    role: user.role,
  });
  const [account, setAccount] = useState({
    active: user.active,
    mustChangePassword: user.mustChangePassword,
  });
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [deleteBlock, setDeleteBlock] = useState(undefined); // undefined = checking
  const set = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  // Same server rules as the delete itself: self and the last admin.
  useEffect(() => {
    SchatAccount.deletePreview([user.id]).then((r) =>
      setDeleteBlock(
        r?.success
          ? r.items?.[0]?.blocked || null
          : r?.error || "지금은 삭제할 수 없습니다."
      )
    );
  }, [user.id]);

  async function submit(e) {
    e.preventDefault();
    const changes = {};
    if (form.name !== (user.name || "")) changes.name = form.name;
    if (!user.employeeNumber && form.employeeNumber)
      changes.employeeNumber = form.employeeNumber;
    if (
      String(form.departmentId) !== String(user.departmentId || "") &&
      form.departmentId
    )
      changes.departmentId = Number(form.departmentId);
    if (form.role !== user.role) changes.role = form.role;
    if (!Object.keys(changes).length) return onClose();
    setSaving(true);
    const result = await SchatAccount.updateAccount(user.id, changes);
    setSaving(false);
    if (!result.success)
      return showToast(result.error || "저장하지 못했습니다.", "error");
    showToast("직원 정보를 저장했습니다.", "success");
    onSaved();
  }

  async function toggleActive() {
    const result = await SchatAccount.bulkStatus([user.id], !account.active);
    if (!result.success || result.failed?.length)
      return showToast(
        result.failed?.[0]?.reason || result.error || "바꾸지 못했습니다.",
        "error"
      );
    setAccount((prev) => ({ ...prev, active: !prev.active }));
    showToast(
      account.active ? "사용중지로 바꿨습니다." : "다시 사용으로 바꿨습니다.",
      "success"
    );
    onChanged?.();
  }

  async function resetPassword() {
    const result = await SchatAccount.resetPassword(user.id);
    setConfirmReset(false);
    if (!result.success)
      return showToast(result.error || "초기화하지 못했습니다.", "error");
    setAccount((prev) => ({ ...prev, mustChangePassword: true }));
    showToast(
      `${user.name} 직원의 비밀번호를 초기화했습니다. 다음 로그인 때 직원이 비밀번호 만들기로 새 비밀번호를 정합니다.`,
      "success"
    );
    onChanged?.();
  }

  return (
    <Modal isOpen onClose={onClose} size="md">
      <ModalHeader
        title="직원 정보 수정"
        subtitle="계정, 사번, 비밀번호와 기존 신고는 그대로 유지됩니다."
        onClose={onClose}
      />
      <ModalBody>
        <form
          onSubmit={submit}
          className="flex flex-col gap-y-3"
          data-testid="edit-basic"
        >
          <p className="text-sm font-semibold text-theme-text-primary">
            기본 정보
          </p>
          <Field label="이름" htmlFor="schat-edit-name">
            <input
              id="schat-edit-name"
              required
              maxLength={50}
              className={inputClass}
              value={form.name}
              onChange={set("name")}
            />
          </Field>
          <Field
            label="사번"
            htmlFor="schat-edit-number"
            help={
              user.employeeNumber
                ? "사번은 바꿀 수 없습니다."
                : "사번을 등록하면 이후에는 부서·사번·이름으로만 로그인합니다. 이름과 부서도 함께 입력해 주세요."
            }
          >
            <input
              id="schat-edit-number"
              maxLength={30}
              disabled={!!user.employeeNumber}
              className={inputClass}
              value={form.employeeNumber}
              onChange={set("employeeNumber")}
            />
          </Field>
          <Field label="부서" htmlFor="schat-edit-dept">
            <select
              id="schat-edit-dept"
              className={inputClass}
              value={form.departmentId}
              onChange={set("departmentId")}
            >
              <option value="">
                {departments.some((d) => d.active)
                  ? "선택하세요"
                  : "사용중인 부서가 없습니다 — 먼저 부서 관리에서 추가하세요"}
              </option>
              {departments
                .filter((d) => d.active || d.id === user.departmentId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.active ? "" : " (사용중지)"}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="권한" htmlFor="schat-edit-role">
            <select
              id="schat-edit-role"
              disabled={isSelf}
              className={inputClass}
              value={form.role}
              onChange={set("role")}
            >
              {roleOptions(user.role).map(([role, label]) => (
                <option key={role} value={role}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {isSelf && (
            <p className="text-xs text-theme-text-secondary">
              본인의 권한과 사용 상태는 바꿀 수 없습니다.
            </p>
          )}
          <div className="flex justify-end gap-x-2">
            <Button variant="secondary" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "저장 중..." : "저장"}
            </Button>
          </div>
        </form>

        <section
          className="flex flex-col gap-y-2 border-t border-theme-sidebar-border pt-4"
          data-testid="edit-status"
        >
          <p className="text-sm font-semibold text-theme-text-primary">
            계정 상태
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={account.active ? "ok" : "neutral"}>
              {account.active ? "사용중" : "사용중지"}
            </Badge>
            <Badge tone={account.mustChangePassword ? "warning" : "neutral"}>
              {account.mustChangePassword
                ? "비밀번호 미설정"
                : "비밀번호 설정됨"}
            </Badge>
            <span className="text-xs text-theme-text-secondary">
              최근 로그인: {when(user.lastLoginAt)}
            </span>
          </div>
        </section>

        <section
          className="flex flex-col gap-y-2 border-t border-theme-sidebar-border pt-4"
          data-testid="edit-account"
        >
          <p className="text-sm font-semibold text-theme-text-primary">
            계정 관리
          </p>
          {isSelf ? (
            <p className="text-xs text-theme-text-secondary">
              본인 계정은 사용중지할 수 없습니다. 본인 비밀번호는 오른쪽 위
              사용자 메뉴의 비밀번호 변경에서 바꿀 수 있습니다.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={toggleActive}>
                  {account.active ? "사용중지" : "다시 사용"}
                </Button>
                {user.employeeNumber &&
                  (confirmReset ? (
                    <>
                      <Button variant="danger" onClick={resetPassword}>
                        초기화 확인
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setConfirmReset(false)}
                      >
                        취소
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmReset(true)}
                    >
                      비밀번호 초기화
                    </Button>
                  ))}
              </div>
              <p className="text-xs text-theme-text-secondary">
                사용중지하면 로그인할 수 없고, 다시 사용하면 계정·비밀번호·신고
                기록이 그대로 돌아옵니다(비밀번호가 없던 직원은 계속 비밀번호
                미설정입니다).
                {user.employeeNumber &&
                  " 비밀번호를 초기화하면 기존 비밀번호와 열려 있던 로그인이 바로 끊기고, 직원은 로그인 화면의 비밀번호 만들기로 새 비밀번호를 정합니다."}
              </p>
            </>
          )}
        </section>

        <section
          className="mt-4 rounded-lg border border-red-500/40 p-4 flex flex-col gap-y-2"
          data-testid="edit-danger"
        >
          <p className="text-sm font-semibold text-red-500">위험 영역</p>
          <p className="text-sm text-theme-text-primary">계정 삭제</p>
          <p className="text-xs text-theme-text-secondary">
            이 직원 계정을 완전히 삭제합니다. 이 작업은 되돌릴 수 없습니다.
            퇴사·휴직은 사용중지를 권장합니다.
          </p>
          {deleteBlock && <p className="text-xs text-red-500">{deleteBlock}</p>}
          <div>
            <Button
              variant="danger"
              disabled={deleteBlock !== null}
              onClick={onDelete}
            >
              계정 삭제
            </Button>
          </div>
        </section>
      </ModalBody>
    </Modal>
  );
}
