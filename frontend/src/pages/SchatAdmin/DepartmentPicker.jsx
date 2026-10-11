import { useState, useId } from "react";
import { groupDepartments } from "./usageSelection";
import { Button, inputClass } from "./ui";

export function DepartmentPickerView({ departments, selected, onChange, open, setOpen, query, setQuery, id }) {
  const groups = groupDepartments(departments, query);
  return <div className="flex flex-col gap-2 text-sm text-theme-text-primary">
    <div className="flex flex-wrap gap-2" aria-label="선택한 부서">
      {selected.map(value => <Button key={value} variant="secondary"
        aria-label={`${departments.find(d => d.id === value)?.name || '부서'} 선택 해제`}
        onClick={() => onChange(selected.filter(item => item !== value))}>
        {departments.find(d => d.id === value)?.name || '부서'} ×
      </Button>)}
    </div>
    <Button variant="secondary" className="self-start" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(!open)}>{selected.length ? `부서 ${selected.length}개 선택` : '전체 부서'} ▼</Button>
    {open && <div id={id} className="rounded-lg border border-theme-sidebar-border p-3"
      onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
      <input className={inputClass} aria-label="부서 이름으로 찾기" placeholder="부서 이름으로 찾기"
        value={query} onChange={event => setQuery(event.target.value)} />
      <Button variant="secondary" onClick={() => onChange([])}>전체 부서</Button>
      <div className="max-h-72 overflow-y-auto">
        {groups.map(group => <fieldset key={group.name} className="my-3 flex flex-col gap-2">
          <legend className="font-semibold">{group.name}</legend>
          {group.items.map(department => <label key={department.id} className="flex items-center gap-2">
            <input type="checkbox" checked={selected.includes(department.id)}
              onChange={() => onChange(selected.includes(department.id)
                ? selected.filter(value => value !== department.id) : [...selected, department.id])} />
            {department.name}
          </label>)}
        </fieldset>)}
        {!groups.length && <p>일치하는 부서가 없습니다.</p>}
      </div>
    </div>}
  </div>;
}

export default function DepartmentPicker(props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  return <DepartmentPickerView {...props} {...{ open, setOpen, query, setQuery, id }} />;
}
