import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

// 동의어 관리 (admin only).
const request = async (path, options = {}) =>
  fetch(`${API_BASE}/schat-admin/synonyms${path}`, {
    headers: baseHeaders(),
    ...options,
  })
    .then(async (res) => ({
      ok: res.ok,
      ...(await res.json().catch(() => ({}))),
    }))
    .catch(() => ({ ok: false, error: "서버에 연결하지 못했습니다." }));

const SchatSynonyms = {
  list: async () => {
    const result = await request("");
    return result.ok ? result.groups || [] : null;
  },
  create: (group) =>
    request("", { method: "POST", body: JSON.stringify(group) }),
  update: (id, change) =>
    request(`/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(change),
    }),
  remove: (id) => request(`/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // 자동 후보 중 기존 묶음에 추가할 단어: 승인하면 묶음에 들어가고, 거절하면
  // 다시 제안되지 않는다.
  approveAddition: (id) =>
    request(`/suggestions/${encodeURIComponent(id)}/approve`, {
      method: "POST",
    }),
  runs: async () => {
    const result = await request("/runs");
    return result.ok ? result.runs || [] : [];
  },
  dismissAddition: (id) =>
    request(`/suggestions/${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
    }),
};

export default SchatSynonyms;
