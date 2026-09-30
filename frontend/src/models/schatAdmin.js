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
  // 사용 통계 (admin only). period: today | 7d | 30d | 90d
  usageStats: async (period = "7d") => {
    return await fetch(
      `${API_BASE}/schat-admin/usage-stats?period=${encodeURIComponent(period)}`,
      { method: "GET", headers: baseHeaders() }
    )
      .then((res) => {
        if (!res.ok) throw new Error("통계를 불러오지 못했습니다.");
        return res.json();
      })
      .catch(() => null);
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
  // 삭제 전 미리보기. A successful preview returns the previewToken that the
  // delete call below needs.
  storagePreview: async (keys = []) => {
    return await fetch(`${API_BASE}/schat-admin/storage-cleanup/preview`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ keys }),
    })
      .then((res) => res.json())
      .catch(() => null);
  },
  // 실제 삭제: the server re-validates everything before and after deleting.
  storageDelete: async (keys = [], previewToken) => {
    return await fetch(`${API_BASE}/schat-admin/storage-cleanup/delete`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ keys, previewToken, confirm: true }),
    })
      .then((res) => res.json())
      .catch(() => ({ ok: false, message: "서버에 연결하지 못했습니다." }));
  },
  // 연결 정보가 없는 원본 PDF 삭제: each file is judged again by the server.
  storageDeleteOriginals: async (keys = []) => {
    return await fetch(
      `${API_BASE}/schat-admin/storage-cleanup/originals/delete`,
      {
        method: "POST",
        headers: baseHeaders(),
        body: JSON.stringify({ keys, confirm: true }),
      }
    )
      .then((res) => res.json())
      .catch(() => ({ ok: false, message: "서버에 연결하지 못했습니다." }));
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
