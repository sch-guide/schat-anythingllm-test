import { useEffect, useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import SchatAccount from "@/models/schatAccount";
import showToast from "@/utils/toast";
import { Button, Loading, Notice, inputClass } from "../ui";

// 계정 삭제 (완전삭제). Always previews first, lists linked data and asks for a
// typed confirmation: the employee's name for one account, "삭제" for several.
// The server checks the same rules again before deleting.
export default function DeleteAccountsDialog({ ids, onClose, onDeleted }) {
  const [plan, setPlan] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    SchatAccount.deletePreview(ids).then((r) =>
      setPlan(r?.success ? r : { error: r?.error || "확인하지 못했습니다." })
    );
  }, [ids]);

  async function submit(e) {
    e.preventDefault();
    setDeleting(true);
    const result = await SchatAccount.deleteAccounts(ids, confirm);
    setDeleting(false);
    if (!result.success)
      return showToast(result.error || "삭제하지 못했습니다.", "error");
    showToast(`${result.deletedCount}명의 계정을 삭제했습니다.`, "success");
    onDeleted?.();
  }

  const single = plan?.items?.length === 1;
  const blocked = plan?.items?.filter((i) => i.blocked) || [];
  const active = plan?.items?.filter((i) => i.active) || [];
  const total = (key) =>
    (plan?.items || []).reduce((s, i) => s + (i.linked?.[key] || 0), 0);

  return (
    <Modal isOpen onClose={onClose} size="lg">
      <ModalHeader
        title={
          single
            ? "직원 계정을 삭제하시겠습니까?"
            : `선택 사용자 삭제 (${plan?.items?.length ?? ids.length}명)`
        }
        onClose={onClose}
      />
      <ModalBody>
        {!plan ? (
          <Loading />
        ) : plan.error ? (
          <Notice tone="warning">{plan.error}</Notice>
        ) : (
          <form
            onSubmit={submit}
            className="flex flex-col gap-y-3"
            data-testid="delete-dialog"
          >
            <Notice>
              완전삭제는 잘못 만든 계정, 테스트·중복 계정, 실제 직원이 아닌
              계정처럼 더 보관할 필요가 없는 계정에만 사용하세요. 퇴사·휴직은
              사용중지를 권장합니다. 삭제한 계정은 되돌릴 수 없습니다.
            </Notice>
            {single && (
              <dl
                className="grid grid-cols-[4rem_1fr] gap-y-1 text-sm"
                data-testid="delete-single"
              >
                <dt className="text-theme-text-secondary">이름</dt>
                <dd className="text-theme-text-primary">
                  {plan.items[0].name}
                </dd>
                <dt className="text-theme-text-secondary">사번</dt>
                <dd className="text-theme-text-primary">
                  {plan.items[0].employeeNumber || "-"}
                </dd>
                <dt className="text-theme-text-secondary">부서</dt>
                <dd className="text-theme-text-primary">
                  {plan.items[0].department || "-"}
                </dd>
              </dl>
            )}
            <ul className="max-h-[220px] overflow-y-auto flex flex-col gap-y-1.5 text-sm">
              {plan.items.map((u) => (
                <li
                  key={u.id}
                  className="rounded-lg border border-theme-sidebar-border px-3 py-2"
                >
                  <p className="font-medium text-theme-text-primary">
                    {u.name}
                    <span className="text-xs text-theme-text-secondary ml-2">
                      {[u.department, u.employeeNumber]
                        .filter(Boolean)
                        .join(" · ")}{" "}
                      · {u.active ? "사용중" : "사용중지"}
                    </span>
                  </p>
                  <p className="text-xs text-theme-text-secondary">
                    연결된 데이터: 문제 신고 {u.linked.reports}건 · 알림{" "}
                    {u.linked.notifications}건 · 대화 기록 {u.linked.chats}건
                  </p>
                  {u.blocked && (
                    <p className="text-xs text-red-500">{u.blocked}</p>
                  )}
                  {!u.blocked && u.warning && (
                    <p className="text-xs text-amber-500">{u.warning}</p>
                  )}
                </li>
              ))}
            </ul>
            <Notice tone="warning">
              <p>계정을 삭제하면 다시 로그인할 수 없습니다.</p>
              <p>
                문제 신고 {total("reports")}건은 신고 당시 이름·사번·부서와 함께
                그대로 남고 (삭제된 사용자)로 표시됩니다. 이용 가이드 통계도
                그대로입니다.
              </p>
              <p>
                개인 알림 {total("notifications")}건과 개인 대화 기록{" "}
                {total("chats")}건은 함께 삭제됩니다.
              </p>
              {active.length > 0 && (
                <p>
                  이 중 {active.length}명은 현재 사용중인 계정입니다. 삭제 대신
                  사용중지를 권장합니다.
                </p>
              )}
            </Notice>
            {blocked.length > 0 ? (
              <p className="text-sm text-red-500">
                삭제할 수 없는 계정이 포함되어 있습니다. 선택에서 빼고 다시
                시도해 주세요.
              </p>
            ) : (
              <label className="flex flex-col gap-y-1.5 text-sm text-theme-text-primary">
                {single
                  ? `삭제 확인을 위해 직원 이름(${plan.confirmText})을 입력하세요.`
                  : "삭제 확인을 위해 '삭제'를 입력하세요."}
                <input
                  aria-label="삭제 확인 입력"
                  className={`${inputClass} max-w-[260px]`}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                />
              </label>
            )}
            <div className="flex justify-end gap-x-2">
              <Button variant="secondary" onClick={onClose}>
                취소
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={
                  deleting ||
                  blocked.length > 0 ||
                  confirm.trim() !== plan.confirmText.trim()
                }
              >
                {deleting
                  ? "삭제 중..."
                  : single
                    ? "계정 삭제"
                    : `${plan.items.length}명 삭제`}
              </Button>
            </div>
          </form>
        )}
      </ModalBody>
    </Modal>
  );
}
