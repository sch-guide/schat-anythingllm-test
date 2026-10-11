export function groupDepartments(departments, query = "") {
  const groups = ["병동", "중환자실", "응급·수술", "기타"].map(name => ({ name, items: [] }));
  const word = query.trim().toLocaleLowerCase();
  for (const department of departments) {
    const name = String(department.name || "");
    if (!name.toLocaleLowerCase().includes(word)) continue;
    const compact = name.replace(/\s/g, "").toUpperCase();
    const group = /^(CCU|EICU|MICU|NICU|SICU)$/.test(compact) || /중환자실/.test(name)
      ? 1 : /^(성인ER|소아ER|수술실|마취회복실)$/.test(compact)
        ? 2 : /병동/.test(name) ? 0 : 3;
    groups[group].items.push(department);
  }
  return groups.filter(group => group.items.length);
}

export function selectionError(period, start, end, today) {
  if (period !== "custom") return "";
  const days = (new Date(end) - new Date(start)) / 86400000;
  return !start || !end || !Number.isFinite(days) || days < 0 || days >= 366 || end > today
    ? "날짜를 확인해 주세요. 최대 366일이며 미래 날짜는 선택할 수 없습니다."
    : "";
}
