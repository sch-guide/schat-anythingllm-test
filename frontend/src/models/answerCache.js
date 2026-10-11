import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}/schat-admin/answer-cache${path}`, {
    cache: "no-store",
    ...options,
    headers: {
      ...baseHeaders(),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data?.error || "답변 재사용 요청을 처리하지 못했습니다.");
  return data;
}
const AnswerCache = {
  async list(workspaceId) {
    const data = await request(`?${new URLSearchParams({ workspaceId })}`);
    if (
      !Array.isArray(data?.entries) ||
      !Number.isFinite(data?.stats?.savedAnswerCalls)
    )
      throw new Error("답변 재사용 현황을 확인하지 못했습니다.");
    return data;
  },
  remove(workspaceId, id) {
    return request(
      `/${encodeURIComponent(id)}?${new URLSearchParams({ workspaceId })}`,
      { method: "DELETE" },
    );
  },
  clear() {
    return request("/clear", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    });
  },
};
export default AnswerCache;
