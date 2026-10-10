import { useEffect, useState } from "react";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { inputClass } from "./ui";

export default function ChatAdmissionPanel() {
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
        setLimit((current) =>
          current === "" ? String(data.maxActive) : current
        );
      } catch {
        if (!controller.signal.aborted) setState(null);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    }
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
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
      <h2 className="font-bold mb-2">동시 답변과 대기열</h2>
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
      <p className="text-xs mt-2 text-theme-text-secondary">
        로그인 인원이 아닌 답변 처리 수입니다. 1인당 처리·대기 합계 1건, 대기
        최대 30초, 처리 최대 120초입니다. Gemini 자체 호출 한도와는 별개이며
        기본 4건은 부하 테스트 후 조정해야 합니다.
      </p>
    </section>
  );
}
