import React, { useEffect, useState } from "react";
import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { Card, Field, Help, Button, inputClass } from "./ui";
import {
  BUDGET_NOTICE,
  useGeminiAvailability,
} from "./GeminiAvailabilityBanner";

const labels = {
  normal: "정상",
  busy: "일시적 혼잡",
  exhausted: "한도 소진",
  other: "기타 오류",
  unknown: "아직 확인되지 않음",
};
const time = (value) =>
  value
    ? new Date(value).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour12: false,
      })
    : "기록 없음";
const number = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })
    : null;

export function GeminiBudgetSummary({ budget }) {
  const available =
    Number.isFinite(budget?.percent) && Number.isFinite(budget?.estimatedKrw);
  return (
    <div className="space-y-2 text-sm text-theme-text-primary">
      <p>
        이번 달 채팅 기준 추정 사용:{" "}
        {available ? `약 ${number(budget.estimatedKrw)}원` : "계산 불가"}
      </p>
      <p>
        예상 사용률: {available ? `${number(budget.percent)}%` : "계산 불가"}
      </p>
      <p>
        예상 잔여 예산:{" "}
        {available ? `${number(budget.remainingPercent)}%` : "계산 불가"}
      </p>
      {!available && (
        <p>{budget?.reason || "사용량 또는 단가 설정이 부족함."}</p>
      )}
      <p className="text-theme-text-secondary">채팅 사용 기록 기준 추정치입니다. <Help>{BUDGET_NOTICE}</Help></p>
      <Help>
        한국 시간 기준 이번 달 기록을 계산함. 과거 대화가 삭제되면 추정치도
        달라질 수 있음. 단가 변경 시 이번 달 전체 기록에 적용함.
      </Help>
      {budget?.missingChats > 0 && (
        <p>사용량 확인이 필요한 채팅 기록: {budget.missingChats}건</p>
      )}
    </div>
  );
}

export default function GeminiBudgetPanel() {
  const { data, error, reload } = useGeminiAvailability();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (form || !data?.budget?.config) return;
    const config = data.budget.config;
    const models = [
      ...new Set([
        ...(config.rates || []).map((r) => r.model),
        ...(data.budget.models || []),
      ]),
    ];
    setForm({
      monthlyBudgetKrw: config.monthlyBudgetKrw ?? "",
      rates: models.length
        ? models.map(
            (model) =>
              config.rates.find((r) => r.model === model) || {
                model,
                inputKrw: "",
                outputKrw: "",
              }
          )
        : [{ model: "", inputKrw: "", outputKrw: "" }],
    });
  }, [data, form]);
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const body = {
        monthlyBudgetKrw: Number(form.monthlyBudgetKrw),
        rates: form.rates.map((r) => ({
          model: r.model.trim(),
          inputKrw: Number(r.inputKrw),
          outputKrw: Number(r.outputKrw),
        })),
      };
      const response = await fetch(`${API_BASE}/schat-admin/gemini-budget`, {
        method: "PUT",
        headers: { ...baseHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw Error("save");
      setMessage("설정을 저장함. 예산 추정치를 다시 불러옴.");
      reload();
    } catch {
      setMessage(
        "저장하지 못함. 월 예산·모델 이름·양수 단가를 확인한 뒤 다시 시도해 주세요."
      );
    } finally {
      setSaving(false);
    }
  }
  function changeRate(index, key, value) {
    setForm((old) => ({
      ...old,
      rates: old.rates.map((r, i) =>
        i === index ? { ...r, [key]: value } : r
      ),
    }));
  }
  return (
    <Card
      title="예상 비용 설정"
      help="실제 AI 연결 상태와 채팅 사용량 기준 예산 추정치는 서로 별개입니다."
    >
      {error && (
        <p role="alert">
          최근 정보를 불러오지 못함. 아래 정보는 최신 상태가 아닐 수 있음.
        </p>
      )}
      <div className="text-sm text-theme-text-primary space-y-1">
        <p>AI 상태: {labels[data?.state?.status] || "확인 중"}</p>
        {data?.state?.firstOccurredAt && (
          <p>
            한도 소진 최초 발생: {time(data.state.firstOccurredAt)} (한국 시간)
          </p>
        )}
        <p>마지막 정상 호출: {time(data?.state?.lastSuccessAt)}</p>
        <p>
          마지막 오류: {labels[data?.state?.lastErrorKind] || "기록 없음"} ·{" "}
          {time(data?.state?.lastErrorAt)}
        </p>
        {data?.state?.persistenceError && (
          <p role="alert">
            상태 저장 오류: 서버 재시작 후 유지 여부를 확인할 수 없음.
          </p>
        )}
      </div>
      <GeminiBudgetSummary budget={data?.budget} />
      {form && (
        <form onSubmit={save} className="flex flex-col gap-3">
          <Field label="월 AI 예산 (원)" htmlFor="gemini-month-budget">
            <input
              id="gemini-month-budget"
              required
              min="1"
              max="1000000000000"
              type="number"
              className={inputClass}
              value={form.monthlyBudgetKrw}
              onChange={(e) =>
                setForm({ ...form, monthlyBudgetKrw: e.target.value })
              }
            />
          </Field>
          <Help>
            모델별 처리 단위 100만 개당 예상 원화 단가를 입력함. 공식 가격과 환율을
            확인하여 정하는 관리용 단가이며 실제 청구액이 아님.
          </Help>
          {form.rates.map((rate, index) => (
            <div
              key={index}
              className="grid grid-cols-1 md:grid-cols-3 gap-2 border border-theme-sidebar-border rounded-lg p-3"
            >
              <Field
                label="기록된 Gemini 모델 이름"
                htmlFor={`gemini-model-${index}`}
              >
                <input
                  id={`gemini-model-${index}`}
                  required
                  maxLength={107}
                  className={inputClass}
                  value={rate.model}
                  placeholder="gemini-…"
                  onChange={(e) => changeRate(index, "model", e.target.value)}
                />
              </Field>
              <Field
                label="읽는 분량 100만 단위 예상 단가 (원)"
                htmlFor={`gemini-input-${index}`}
              >
                <input
                  id={`gemini-input-${index}`}
                  required
                  type="number"
                  min="0.000001"
                  step="any"
                  max="1000000000"
                  className={inputClass}
                  value={rate.inputKrw}
                  onChange={(e) =>
                    changeRate(index, "inputKrw", e.target.value)
                  }
                />
              </Field>
              <Field
                label="작성 분량 100만 단위 예상 단가 (원)"
                htmlFor={`gemini-output-${index}`}
              >
                <input
                  id={`gemini-output-${index}`}
                  required
                  type="number"
                  min="0.000001"
                  step="any"
                  max="1000000000"
                  className={inputClass}
                  value={rate.outputKrw}
                  onChange={(e) =>
                    changeRate(index, "outputKrw", e.target.value)
                  }
                />
              </Field>
              {form.rates.length > 1 && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setForm({
                      ...form,
                      rates: form.rates.filter((_, i) => i !== index),
                    })
                  }
                >
                  이 단가 설정 제거
                </Button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={form.rates.length >= 30}
              onClick={() =>
                setForm({
                  ...form,
                  rates: [
                    ...form.rates,
                    { model: "", inputKrw: "", outputKrw: "" },
                  ],
                })
              }
            >
              모델 단가 추가
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "저장 중…" : "예산 설정 저장"}
            </Button>
          </div>
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
