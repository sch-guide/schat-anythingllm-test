import React, { useEffect, useState } from "react";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { Field, Button, Card, Help, inputClass } from "./ui";
import { money, questions, days } from "./aiFeesPresentation";
import { useGeminiAvailability } from "./GeminiAvailabilityBanner";

const todayKst = () =>
  new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const fresh = () => ({ id: null, amountKrw: "", date: todayKst() });
const amount = (value) =>
  value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

export function GeminiBudgetSummary({ budget }) {
  const available =
    Number.isFinite(budget?.estimatedKrw) &&
    Number.isFinite(budget?.remainingKrw);
  return (
    <div className="space-y-3 text-theme-text-primary" aria-live="polite">
      {available ? (
        <>
          <p className="text-lg font-semibold">
            충전 {amount(budget.totalChargedKrw)}원 중{" "}
            {money(budget.estimatedKrw)} 썼어요
          </p>
          <div
            role="progressbar"
            aria-label="충전 금액 중 예상 사용 비율"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.max(0, budget.percent))}
            className="h-3 overflow-hidden rounded-full bg-theme-sidebar-border"
          >
            <div
              className={`h-full ${budget.level === "high" ? "bg-red-500" : budget.level === "warning" ? "bg-amber-500" : "bg-sky-500"}`}
              style={{
                width: `${Math.min(100, Math.max(0, budget.percent))}%`,
              }}
            />
          </div>
        </>
      ) : (
        <>
          <p className="font-semibold">계산 불가</p>
          <p className="text-sm">
            {budget?.reason || "충전 기록과 사용량을 확인하고 있어요."}
          </p>
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["남은 돈", available ? money(budget.remainingKrw) : "계산 불가"],
          [
            "더 할 수 있는 질문",
            available ? questions(budget.questionsRemaining) : "계산 불가",
          ],
          [
            "지금 속도라면",
            available ? days(budget.daysRemaining) : "계산 불가",
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className={`rounded-lg border p-3 ${available && budget.level === "high" ? "border-red-400 bg-red-50 text-red-950" : available && budget.level === "warning" ? "border-amber-400 bg-amber-50 text-amber-950" : "border-theme-sidebar-border"}`}
          >
            <p className="text-sm">{label}</p>
            <p className="mt-1 font-semibold">{value}</p>
          </div>
        ))}
      </div>
      {available && budget.partial && budget.reason && (
        <p className="text-sm text-theme-text-secondary">
          {budget.reason}. 빠진 기록만큼 실제 사용 금액은 더 클 수 있어요.
        </p>
      )}
      <p className="text-sm text-theme-text-secondary">
        SCHAT에 기록된 채팅만 계산한 추정치예요. 실제 잔액과 다를 수 있어요.
      </p>
      <Help
        label="예상 질문과 기간 도움말"
        heading={
          <span className="text-xs text-theme-text-secondary">
            예상 질문과 기간
          </span>
        }
      >
        {[
          "최근 7일 중 3일 이상, AI가 새로 답한 질문 10번 이상 기록되면 앞으로 쓸 수 있는 양을 예상해요.",
          "한국 시간 기준이며 기록이 지워지면 추정치도 달라져요.",
        ]}
      </Help>
    </div>
  );
}

export default function GeminiBudgetPanel() {
  const { data, error, reload } = useGeminiAvailability();
  const [form, setForm] = useState(fresh);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const budget = data?.budget;
  useEffect(() => {
    setRefreshing(false);
  }, [data, error]);
  const disabled =
    saving || refreshing || !Number.isSafeInteger(budget?.revision);
  async function mutate(method, record, body) {
    setSaving(true);
    setMessage("");
    let failure = "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
    try {
      const response = await fetch(
        `${API_BASE}/schat-admin/ai-recharges${record ? `/${encodeURIComponent(record.id)}` : ""}`,
        {
          method,
          headers: { ...baseHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ revision: budget.revision, ...body }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        failure =
          result.error ||
          "저장하지 못했어요. 입력한 내용을 확인하고 다시 시도해 주세요.";
        throw Error("save_failed");
      }
      setForm(null);
      setMessage(
        method === "DELETE"
          ? "충전 기록을 지웠어요."
          : "충전 기록을 저장했어요."
      );
      setRefreshing(true);
      reload();
    } catch {
      setMessage(failure);
    } finally {
      setSaving(false);
    }
  }
  function save(event) {
    event.preventDefault();
    return mutate(form.id ? "PUT" : "POST", form.id ? form : null, {
      amountKrw: Number(form.amountKrw),
      date: form.date,
    });
  }
  function remove(record) {
    if (
      !window.confirm(
        `${record.date} 충전 ${amount(record.amountKrw)}원 기록을 지울까요?`
      )
    )
      return;
    return mutate("DELETE", record, {});
  }
  return (
    <Card
      title="AI 사용 요금"
      description="충전한 돈이 얼마나 남았는지 보여 줘요."
      help={[
        "SCHAT에 기록된 채팅 요금만 추정해요. 오래된 기록은 확인이 어려워 계산하지 못할 수 있어요.",
        "문서 검색 자료 만들기, PDF 이미지 설명, 퀴즈·동의어 생성 비용은 빠져 있어요.",
        "실제 잔액과 청구 금액은 AI Studio 결제 화면에서 확인해요.",
      ]}
    >
      {error && (
        <p role="alert" className="text-amber-600">
          최신 정보를 불러오지 못했어요. 새로고침한 뒤 다시 확인해 주세요.
        </p>
      )}
      <GeminiBudgetSummary budget={budget} />
      {refreshing && <p role="status">최신 요금을 다시 불러오고 있어요.</p>}
      {form ? (
        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="충전 금액 (원)" htmlFor="ai-recharge-amount">
              <input
                id="ai-recharge-amount"
                type="number"
                min="0.01"
                max="1000000000000"
                step="any"
                required
                disabled={disabled}
                className={inputClass}
                value={form.amountKrw}
                onChange={(e) =>
                  setForm({ ...form, amountKrw: e.target.value })
                }
              />
            </Field>
            <Field label="충전한 날" htmlFor="ai-recharge-date">
              <input
                id="ai-recharge-date"
                type="date"
                required
                max={todayKst()}
                disabled={disabled}
                className={inputClass}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={disabled}>
              {saving ? "저장 중…" : "저장"}
            </Button>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setForm(null);
                setMessage("");
              }}
            >
              취소
            </Button>
          </div>
        </form>
      ) : (
        <Button
          className="self-start"
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            setForm(fresh());
            setMessage("");
          }}
        >
          + 다시 충전했어요
        </Button>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <h3 className="font-medium">충전 기록</h3>
      <ul aria-label="충전 기록" className="space-y-2">
        {(budget?.records || []).map((record) => (
          <li
            key={record.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-theme-sidebar-border py-2"
          >
            <span>
              {record.date} · {amount(record.amountKrw)}원
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => {
                  setForm({ ...record });
                  setMessage("");
                }}
              >
                고치기
              </Button>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => remove(record)}
              >
                지우기
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {!budget?.records?.length && (
        <p className="text-sm">충전한 금액과 날짜를 추가해 주세요.</p>
      )}
      <p className="text-xs text-theme-text-secondary">
        요금은 프로그램이 알아서 계산해요 (
        {budget?.models?.join(", ") || "Gemini 3.8 Flash"} · 요금표 기준일{" "}
        {budget?.priceVerified || "2026-10-11"}). 정확한 금액은 AI Studio 결제
        화면에서 확인하세요.
      </p>
    </Card>
  );
}
