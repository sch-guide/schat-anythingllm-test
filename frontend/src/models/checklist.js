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
};

export default Checklist;
