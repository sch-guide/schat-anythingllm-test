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
};

export default SchatSynonyms;
