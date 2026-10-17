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
export function chatFilterQuery(filter) {
  if (!filter) return {};
  const query = {};
  for (const key of ["kind", "document", "topic", "startDate", "endDate"])
    if (filter[key]) query[key] = String(filter[key]);
  if (filter.departmentIds?.length)
    query.departmentIds = filter.departmentIds.join(",");
  return query;
}
const ChunkViewer = {
  documents: (workspaceId, offset = 0) =>
    request("chunk-documents", { workspaceId, offset }),
  chunks: (workspaceId, { documentId, q = "", offset = 0 }) =>
    request("chunks", { workspaceId, documentId, q, offset }),
  // filter: 통계에서 고른 조건(kind·document·topic·startDate·endDate·departmentIds)
  chats: (workspaceId, offset = 0, filter = null) =>
    request("chunk-chats", { workspaceId, offset, ...chatFilterQuery(filter) }),
  chat: (workspaceId, id) =>
    request(`chunk-chats/${encodeURIComponent(id)}`, { workspaceId }, true),
};
export default ChunkViewer;
