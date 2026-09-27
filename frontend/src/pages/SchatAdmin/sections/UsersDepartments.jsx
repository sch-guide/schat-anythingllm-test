import { useState } from "react";
import SchatAccount from "@/models/schatAccount";
import showToast from "@/utils/toast";
import { Badge, Button, Card, inputClass } from "../ui";

// Departments are never deleted, so no account ever loses its department.
export default function Departments({ departments, onChanged }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");

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
      description="로그인 화면의 부서 목록입니다. 직원이 있는 부서는 지우지 않고 사용중지합니다. 사용중지된 부서는 로그인 목록과 새 등록에서 빠집니다."
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
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
