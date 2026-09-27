import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const SchatAdmin = {
  status: async () => {
    return await fetch(`${API_BASE}/schat-admin/status`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => {
        if (!res.ok) throw new Error("상태를 불러오지 못했습니다.");
        return res.json();
      })
      .catch((e) => {
        console.error(e.message);
        return null;
      });
  },
  storageReport: async ({ refresh = false } = {}) => {
    const query = refresh ? "?refresh=1" : "";
    return await fetch(`${API_BASE}/schat-admin/storage-cleanup${query}`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => {
        if (!res.ok) throw new Error("저장공간 정보를 불러오지 못했습니다.");
        return res.json();
      })
      .catch(() => null);
  },
  // 삭제 전 미리보기 only - there is no delete call.
  storagePreview: async (keys = []) => {
    return await fetch(`${API_BASE}/schat-admin/storage-cleanup/preview`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ keys }),
    })
      .then((res) => res.json())
      .catch(() => null);
  },
  connectionTest: async (target) => {
    return await fetch(`${API_BASE}/schat-admin/connection-test`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ target }),
    })
      .then((res) => res.json())
      .catch(() => ({
        ok: false,
        code: "failed",
        message: "연결을 확인하지 못했습니다.",
      }));
  },
};

export default SchatAdmin;
