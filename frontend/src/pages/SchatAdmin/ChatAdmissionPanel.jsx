import { useEffect, useState } from "react";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { Help, inputClass } from "./ui";

export default function ChatAdmissionPanel({ onState, showDaily = true }) {
  const [state, setState] = useState(null);
  const [limit, setLimit] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/schat-admin/chat-admission`, {
          headers: baseHeaders(),
          signal: controller.signal,
        });
        if (!res.ok) throw Error();
        const data = await res.json();
        if (controller.signal.aborted) return;
        setState(data);
        onState?.(data);
        setLimit((current) =>
          current === "" ? String(data.maxActive) : current
        );
      } catch {
        if (!controller.signal.aborted) { setState(null); onState?.(null); }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    }
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [onState]);
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch(`${API_BASE}/schat-admin/chat-admission`, {
        method: "PUT",
        headers: baseHeaders(),
        body: JSON.stringify({ maxActive: Number(limit) }),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      setState(data);
      setNotice("저장했습니다. 진행 중인 답변은 유지됩니다.");
    } catch (error) {
      setNotice(error.message || "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="rounded-xl border border-theme-sidebar-border p-4 text-theme-text-primary">
      <h2 className="font-bold mb-2">동시 답변 수 <Help>로그인 인원이 아닌 답변 처리 수입니다. 한 사람은 한 번에 한 질문만 처리하거나 기다릴 수 있습니다. 대기는 최대 15초, 처리는 최대 80초입니다. 기본값은 4건입니다.</Help></h2>
      <p className="text-sm mb-3">
        {state
          ? `현재 답변 중 ${state.active}건 / 대기 중 ${state.waiting}건 (최대 10건)`
          : "현황을 불러오는 중이거나 연결할 수 없습니다."}
      </p>
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          최대 동시 답변 수
          <input
            aria-label="최대 동시 답변 수"
            type="number"
            min="1"
            max="16"
            step="1"
            required
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={saving || !state}
          className="rounded-lg border px-4 py-2 disabled:opacity-50"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      </form>
      <p role="status" className="text-sm mt-2">
        {notice}
      </p>
      {showDaily && <div className={`mt-4 rounded-lg border p-3 ${state?.dailyUsage?.warning ? "border-amber-500 bg-amber-500/10" : "border-theme-sidebar-border"}`}>
        <h3 className="font-semibold">답변 모델 하루 호출 시도</h3>
        <p>{state?.dailyUsage?.available
          ? `오늘 ${state.dailyUsage.count.toLocaleString()} / 10,000건${state.dailyUsage.warning ? " · 70% 이상 사용 주의" : ""}`
          : "집계 확인 불가"}</p>
        <p className="text-xs mt-2 text-theme-text-secondary">
          {state?.dailyUsage?.model && `모델: ${state.dailyUsage.model}. `}
          이 SCHAT 서버에서 관측한 호출 시도이며 재시도·실패도 포함합니다.
          다른 서버와 RAGAS 등의 사용량은 포함하지 않아 Google 전체 사용량과 다릅니다.
          한국 시간 오후 4시(미국 서머타임) 또는 5시에 새 날짜로 계산합니다.
          답변을 재사용하면 증가하지 않습니다. 이 숫자로 질문을 차단하지 않습니다.
        </p>
        {state?.dailyUsage?.startedAt && <p className="text-xs mt-1">
          집계 시작: {new Date(state.dailyUsage.startedAt).toLocaleString("ko-KR", {timeZone: "Asia/Seoul"})} (시작 전 호출 제외)
        </p>}
      </div>}
    </section>
  );
}
