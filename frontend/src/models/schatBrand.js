import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function request(options) {
  const response = await fetch(`${API_BASE}/system/schat-brand`, {
    cache: "no-store",
    ...options,
  });
  const result = await response.json();
  if (!response.ok || !result?.brand)
    throw Error(result?.error || "브랜드 설정을 처리하지 못했습니다.");
  return result.brand;
}
export default {
  read: () => request(),
  save: (section, value, reset = false) =>
    request({
      method: "PUT",
      headers: { ...baseHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ section, value, reset }),
    }),
};
