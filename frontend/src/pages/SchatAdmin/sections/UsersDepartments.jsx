import { useState } from "react";
import Modal, { ModalBody, ModalHeader } from "@/components/lib/Modal";
import SchatAccount from "@/models/schatAccount";
import showToast from "@/utils/toast";
import { Badge, Button, Card, Notice, inputClass } from "../ui";

// Only a department without any account can be deleted (e.g. a test
// department); the server checks the count again. Departments with staff are
// suspended instead, so no account ever loses its department.
export function canDeleteDepartment(department = {}) {
  return Number(department.userCount) === 0;
}

function DeleteDepartmentDialog({ department, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    const result = await SchatAccount.deleteDepartment(department.id);
    setBusy(false);
    if (!result.success)
      return showToast(result.error || "부서를 삭제하지 못했습니다.", "error");
    showToast(`${department.name} 부서를 삭제했습니다.`, "success");
    onDeleted?.();
  }
  return (
    <Modal isOpen onClose={onClose} size="md">
      <ModalHeader
        title={`${department.name} 부서를 삭제하시겠습니까?`}
        onClose={onClose}
      />
      <ModalBody>
        <div
          className="flex flex-col gap-y-3"
          data-testid="department-delete-dialog"
        >
          <Notice tone="warning">
            이 작업은 되돌릴 수 없습니다. 직원이 없는 부서만 삭제되며, 직원
            계정과 다른 부서는 바뀌지 않습니다.
          </Notice>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              취소
            </Button>
            <Button variant="danger" onClick={remove} disabled={busy}>
              {busy ? "삭제 중..." : "삭제"}
            </Button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

export default function Departments({ departments, onChanged }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState(null);

  async function add(e) {
    e.preventDefault();
    const result = await SchatAccount.createDepartment({ name });
    if (!result.success)
      return showToast(result.error || "부서를 추가하지 못했습니다.", "error");
    setName("");
    onChanged();
  }

  async function update(id, changes) {
    const result = await SchatAccount.updateDepartment(id, changes);
    if (!result.success)
      return showToast(result.error || "저장하지 못했습니다.", "error");
    setEditing(null);
    onChanged();
  }

  return (
    <Card
      title="부서 관리"
      description="로그인 화면의 부서 목록입니다. 직원이 있는 부서는 지우지 않고 사용중지합니다. 사용중지된 부서는 로그인 목록과 새 등록에서 빠집니다. 직원이 0명인 부서(테스트 부서 등)는 삭제할 수 있습니다."
    >
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input
          aria-label="새 부서 이름"
          placeholder="새 부서 이름"
          required
          maxLength={50}
          className={`${inputClass} max-w-[260px]`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit">부서 추가</Button>
      </form>
      <ul className="flex flex-col">
        {departments.length === 0 && (
          <li className="text-sm text-theme-text-secondary py-2">
            등록된 부서가 없습니다.
          </li>
        )}
        {departments.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-theme-sidebar-border last:border-b-0"
          >
            {editing === d.id ? (
              <span className="flex gap-2">
                <input
                  aria-label="부서 이름"
                  className={`${inputClass} max-w-[220px]`}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <Button onClick={() => update(d.id, { name: editName })}>
                  저장
                </Button>
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  취소
                </Button>
              </span>
            ) : (
              <span className="text-sm text-theme-text-primary">
                {d.name}{" "}
                <span className="text-xs text-theme-text-secondary">
                  직원 {d.userCount}명
                </span>
              </span>
            )}
            <span className="flex items-center gap-2">
              <Badge tone={d.active ? "ok" : "neutral"}>
                {d.active ? "사용중" : "사용중지"}
              </Badge>
              {editing !== d.id && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(d.id);
                    setEditName(d.name);
                  }}
                >
                  이름 변경
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => update(d.id, { active: !d.active })}
              >
                {d.active ? "사용중지" : "다시 사용"}
              </Button>
              {canDeleteDepartment(d) && editing !== d.id && (
                <Button variant="danger" onClick={() => setDeleting(d)}>
                  삭제
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {deleting && (
        <DeleteDepartmentDialog
          department={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}
