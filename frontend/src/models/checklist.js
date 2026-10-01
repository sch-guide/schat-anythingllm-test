import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const Checklist = {
  list: async function (workspaceSlug, { scope = null } = {}) {
    if (!workspaceSlug) return [];
    const query = scope === "admin" ? "?scope=admin" : "";
    return fetch(
      `${API_BASE}/workspace/${encodeURIComponent(workspaceSlug)}/checklists${query}`,
      { headers: baseHeaders(), cache: "no-cache" }
    )
      .then((response) => {
        if (!response.ok) throw new Error("Could not load checklists.");
        return response.json();
      })
      .then((data) => data.checklists || [])
      .catch(() => []);
  },

  update: async function (workspaceSlug, checklistId, definition) {
    const response = await fetch(
      `${API_BASE}/workspace/${encodeURIComponent(workspaceSlug)}/checklists/${encodeURIComponent(checklistId)}`,
      {
        method: "PUT",
        headers: { ...baseHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(definition),
      }
    );
    const data = await response.json().catch(() => ({
      success: false,
      error: "체크리스트를 저장하지 못했습니다.",
    }));
    return { response, data };
  },

  // 자료 분류: "procedure" | "surgery" | "other", or "auto" to go back to the
  // automatic classification. Content and status are not changed.
  setKind: async function (workspaceSlug, checklistId, kind) {
    const response = await fetch(
      `${API_BASE}/workspace/${encodeURIComponent(workspaceSlug)}/checklists/${encodeURIComponent(checklistId)}/kind`,
      {
        method: "PUT",
        headers: { ...baseHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      }
    );
    const data = await response.json().catch(() => ({
      success: false,
      error: "자료 분류를 바꾸지 못했습니다.",
    }));
    return { response, data };
  },

  // status: "needs_review" | "active" (shown to employees) | "hidden"
  setStatus: async function (workspaceSlug, checklistId, status) {
    const response = await fetch(
      `${API_BASE}/workspace/${encodeURIComponent(workspaceSlug)}/checklists/${encodeURIComponent(checklistId)}/status`,
      {
        method: "PUT",
        headers: { ...baseHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }
    );
    const data = await response.json().catch(() => ({
      success: false,
      error: "상태를 바꾸지 못했습니다.",
    }));
    return { response, data };
  },
};

export default Checklist;
