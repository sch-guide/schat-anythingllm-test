import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

// 관리자: 지침서 원본 보기의 보기 전용 자료실
async function readJson(response, fallback) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || fallback);
  return data;
}

const GuidelineLibraryAdmin = {
  list: async function () {
    const response = await fetch(`${API_BASE}/schat-admin/guideline-library`, {
      headers: baseHeaders(),
      cache: "no-store",
    });
    return (await readJson(response, "자료 목록을 불러오지 못했습니다.")).items || [];
  },
  /** file: PDF, title: 표시 이름(선택), pages: [{page, text}] */
  upload: async function ({ file, title, pages }) {
    const form = new FormData();
    form.append("title", title || "");
    form.append("pages", JSON.stringify(pages || []));
    form.append("file", file);
    const headers = baseHeaders();
    delete headers["Content-Type"];
    const response = await fetch(`${API_BASE}/schat-admin/guideline-library`, {
      method: "POST",
      headers,
      body: form,
    });
    return (await readJson(response, "자료를 올리지 못했습니다.")).item;
  },
  remove: async function (id) {
    const response = await fetch(
      `${API_BASE}/schat-admin/guideline-library/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: baseHeaders() }
    );
    await readJson(response, "자료를 삭제하지 못했습니다.");
    return true;
  },
};

export default GuidelineLibraryAdmin;
