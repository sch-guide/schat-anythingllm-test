import React, { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { LegacyHelp as Help } from './LegacyHelp';

export default function GeminiAvailabilityBanner() {
  const { data, error } = useGeminiAvailability();
  return (
    <>
      <GeminiAvailabilityNotice
        alerts={data?.alerts || []}
        budget={data?.budget}
      />
      {(error || data?.state?.persistenceError) && (
        <p role="status" className="text-amber-700 text-sm">
          AI 상태를 읽거나 저장하지 못함. 최근 상태와 재시작 후 유지 여부를
          확인할 수 없음.
        </p>
      )}
    </>
  );
}

export function useGeminiAvailability() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function refresh() {
      try {
        const response = await fetch(
          `${API_BASE}/schat-admin/gemini-availability`,
          {
            headers: baseHeaders(),
            signal: controller.signal,
          }
        );
        if (response.ok) {
          const data = await response.json();
          if (!controller.signal.aborted && Array.isArray(data.alerts)) {
            setData(data);
            setError(false);
          }
        } else if (!controller.signal.aborted) setError(true);
      } catch {
        if (!controller.signal.aborted)
          setError(true); /* Keep previous warning on refresh failure. */
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 15000);
      }
    }
    refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision]);
  return { data, error, reload };
}

export const BUDGET_NOTICE =
  "현재 표시되는 AI 예산 사용률은 SCHAT에 기록된 채팅 사용량을 기준으로 계산한 추정치입니다. 문서 검색 자료 만들기, PDF 이미지 설명, 퀴즈 생성, 동의어 자동 생성 등 일부 Gemini 사용량은 포함되지 않아 실제 사용액과 다를 수 있습니다.";

export function GeminiAvailabilityNotice({ alerts = [], budget }) {
  const warn =
    Number.isFinite(budget?.percent) &&
    ["warning", "high"].includes(budget?.level);
  if (!alerts.length && !warn) return null;
  const first = new Date(alerts[0]?.firstOccurredAt);
  return (
    <div className="flex flex-col gap-3">
      {!!alerts.length && (
        <div
          role="alert"
          className="rounded-lg border border-red-400 bg-red-50 text-red-950 px-4 py-3 break-words"
        >
          <strong>AI 사용 한도가 소진됨</strong>
          <p>
            Gemini 한도를 확인해 주세요. 정상 호출이 확인되면 이 안내가 자동으로
            사라짐.
          </p>
          <p className="text-sm">
            최초 발생:{" "}
            {Number.isFinite(first.getTime())
              ? first.toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                  hour12: false,
                })
              : "확인 필요"}{" "}
            (한국 시간)
          </p>
        </div>
      )}
      {warn && (
        <div
          role="alert"
          className={`rounded-lg border px-4 py-3 break-words ${budget.level === "high" ? "border-red-400 bg-red-50 text-red-950" : "border-amber-400 bg-amber-50 text-amber-950"}`}
        >
          <strong>
            예상 AI 예산 {budget.level === "high" ? "높은 사용량 경고" : "주의"}
          </strong>
          <p>
            설정한 AI 예산의 약{" "}
            {budget.percent.toLocaleString("ko-KR", {
              maximumFractionDigits: 1,
            })}
            %를 사용함.
          </p>
          <p>
            예상 잔여 예산: 약{" "}
            {budget.remainingPercent?.toLocaleString("ko-KR", {
              maximumFractionDigits: 1,
            })}
            %
          </p>
          <p className="text-sm mt-2">채팅 사용 기록 기준 추정치입니다. <Help>{BUDGET_NOTICE}</Help></p>
          <p className="text-sm">
            예산 추정치만으로 질문을 차단하지 않음. 실제 AI 한도 상태와 별개임.
          </p>
        </div>
      )}
    </div>
  );
}
