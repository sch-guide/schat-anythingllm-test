import React, { useEffect, useState } from "react";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

export default function GeminiAvailabilityBanner() {
  const [alerts, setAlerts] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function refresh() {
      try {
        const response = await fetch(`${API_BASE}/schat-admin/gemini-availability`, {
          headers: baseHeaders(), signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          if (!controller.signal.aborted && Array.isArray(data.alerts)) setAlerts(data.alerts);
        }
      } catch { /* A failed refresh is not evidence of recovery. Keep the warning. */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(refresh, 15000); }
    }
    refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  return <GeminiAvailabilityNotice alerts={alerts} />;
}

export function GeminiAvailabilityNotice({ alerts }) {
  if (!alerts.length) return null;
  const first = new Date(alerts[0].firstOccurredAt);
  return (
    <div role="alert" className="rounded-lg border border-amber-400 bg-amber-50 text-amber-950 px-4 py-3 break-words">
      <strong>AI 사용 한도가 소진됨</strong>
      <p>Gemini 한도를 확인해 주세요. 정상 호출이 확인되면 이 안내가 자동으로 사라짐.</p>
      <p className="text-sm">최초 발생: {Number.isFinite(first.getTime()) ? first.toLocaleString("ko-KR", {timeZone:"Asia/Seoul", hour12:false}) : "확인 필요"} (한국 시간)</p>
    </div>
  );
}
