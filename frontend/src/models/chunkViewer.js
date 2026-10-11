import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function request(path, query, detail = false) {
  const response = await fetch(
    `${API_BASE}/schat-admin/${path}?${new URLSearchParams(query)}`,
    {
      method: "GET",
      cache: "no-store",
      headers: baseHeaders(),
    }
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data?.error || "검색 조각 조회에 실패했습니다.");
  if (
    detail
      ? !Array.isArray(data?.sources)
      : !Array.isArray(data?.items) || typeof data.hasMore !== "boolean"
  )
    throw new Error("검색 조각 조회 결과를 확인하지 못했습니다.");
  return data;
}
const ChunkViewer = {
  documents: (workspaceId, offset = 0) =>
    request("chunk-documents", { workspaceId, offset }),
  chunks: (workspaceId, { documentId, q = "", offset = 0 }) =>
    request("chunks", { workspaceId, documentId, q, offset }),
  chats: (workspaceId, offset = 0) =>
    request("chunk-chats", { workspaceId, offset }),
  chat: (workspaceId, id) =>
    request(`chunk-chats/${encodeURIComponent(id)}`, { workspaceId }, true),
};
export default ChunkViewer;
