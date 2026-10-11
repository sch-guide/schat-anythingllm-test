import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import SchatAdmin from "@/models/schatAdmin";
import { Card, Help, InfoRow, Loading, Notice } from "../ui";
import DepartmentPicker from "../DepartmentPicker";
import { selectionError } from "../usageSelection";

// "사용 통계": 무엇을 물었는지 중심. 개인별 목록이나 사람끼리 비교하는 표시는 만들지 않는다.
// 서버가 질문 원문의 환자 정보 같은 숫자를 가린 뒤 보낸다.

export const USAGE_PERIODS = [
  ["today", "오늘"],
  ["7d", "최근 7일"],
  ["30d", "최근 30일"],
  ["90d", "최근 90일"],
];

const BLUE = "#2563eb";
const AXIS = { fill: "var(--theme-text-secondary)", fontSize: 12 };
const n = (value) => Number(value || 0).toLocaleString("ko-KR");

function Chart({ data, dataKey, label, height = 200 }) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
        >
          <CartesianGrid
            stroke="var(--theme-sidebar-border)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis dataKey={dataKey} tick={AXIS} tickLine={false} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} />
          <Tooltip
            formatter={(value) => [`${value}건`, "질문"]}
            labelFormatter={label}
            cursor={{ fill: "rgba(37, 99, 235, 0.08)" }}
          />
          <Bar dataKey="count" fill={BLUE} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function QuestionList({ items = [], total = 0, empty }) {
  if (!items.length)
    return <p className="text-sm text-theme-text-secondary">{empty}</p>;
  return (
    <>
      {total > items.length && (
        <p className="text-xs text-theme-text-secondary">
          최근 {items.length}건만 표시합니다 (전체 {n(total)}건).
        </p>
      )}
      <ul className="flex max-h-80 flex-col overflow-y-auto">
        {items.map((item, index) => (
          <li
            key={`${item.date}-${index}`}
            className="flex items-start justify-between gap-3 border-b border-theme-sidebar-border py-1.5 last:border-b-0"
          >
            <span className="min-w-0 break-words text-sm text-theme-text-primary">
              {item.question}
            </span>
            <span className="shrink-0 text-xs text-theme-text-secondary">
              {item.date}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function UsageStatsSection() {
  const [period, setPeriod] = useState("7d");
  const [stats, setStats] = useState(null);
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [departmentIds, setDepartmentIds] = useState([]);
  const [departments, setDepartments] = useState([]);
  const validation = selectionError(period, startDate, endDate, today);

  useEffect(() => {
    let active = true;
    setStats(null);
    if (validation) return;
    SchatAdmin.usageStats(period, { period, startDate, endDate, departmentIds }).then((result) => {
      if (!active) return;
      setStats(result || { error: true });
      if (result?.availableDepartments) setDepartments(result.availableDepartments);
    }).catch(() => { if (active) setStats({ error: true }); });
    return () => { active = false; };
  }, [period, startDate, endDate, departmentIds, validation]);

  return (
    <div className="flex flex-col gap-y-5">
      <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="기간">
        {[...USAGE_PERIODS, ['custom', '날짜 직접 선택']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={period === key}
            onClick={() => setPeriod(key)}
            className={`rounded-full border px-3.5 py-1.5 text-sm ${
              period === key
                ? "border-sky-500 bg-sky-500/15 font-semibold text-theme-text-primary"
                : "border-theme-sidebar-border text-theme-text-secondary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex flex-wrap gap-3">
          <label>시작일 <input aria-label="시작일" type="date" value={startDate} max={today} onChange={e=>setStartDate(e.target.value)} className="rounded border border-theme-sidebar-border bg-theme-bg-primary p-2" /></label>
          <label>종료일 <input aria-label="종료일" type="date" value={endDate} min={startDate} max={today} onChange={e=>setEndDate(e.target.value)} className="rounded border border-theme-sidebar-border bg-theme-bg-primary p-2" /></label>
        </div>
      )}
      <div>대상 부서 <Help>여러 부서를 고를 수 있습니다. 부서는 현재 계정 정보 기준이며 질문 목록은 최근 90일 이내 최대 100건입니다. 5명 미만 부서의 통계는 숨깁니다. 기존 기록은 삭제하지 않습니다.</Help></div>
      <DepartmentPicker departments={departments} selected={departmentIds} onChange={setDepartmentIds} />
      {validation && <p role="alert" className="text-red-500">{validation}</p>}
      </div>

      {stats?.selection && <p role="status" className="text-sm text-theme-text-secondary">
        적용 기간: {stats.selection.startDate} ~ {stats.selection.endDate} (한국 시간) · 대상: {stats.selection.departmentIds.length ? departments.filter(d=>stats.selection.departmentIds.includes(d.id)).map(d=>d.name).join(', ') : '전체 부서'}
      </p>}

      {validation ? null : !stats ? (
        <Loading />
      ) : stats.error ? (
        <Notice tone="warning">통계를 불러오지 못했습니다. 날짜와 부서 선택을 확인한 뒤 다시 조회해 주세요.</Notice>
      ) : stats.suppressed ? (
        <Notice tone="warning">{stats.message}</Notice>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Card
              title={`질문 수 ${n(stats.questions.total)}건`}
            help="직원이 SCHAT에 물어본 질문 수입니다. 시간은 한국 시간 기준입니다."
            >
              <p className="m-0 text-sm font-medium text-theme-text-primary">
                날짜별
              </p>
              <Chart
                data={stats.questions.daily.map((row) => ({
                  ...row,
                  label: row.date.slice(5).replace("-", "/"),
                }))}
                dataKey="label"
                label={(value) => `${value}`}
              />
              <p className="m-0 text-sm font-medium text-theme-text-primary">
                시간대별
              </p>
              <Chart
                data={stats.questions.hourly.map((row) => ({
                  ...row,
                  label: `${row.hour}시`,
                }))}
                dataKey="label"
                label={(value) => `${value}`}
                height={180}
              />
            </Card>
          </div>

          <Card
            title="많이 검색된 주제"
            help="답변에 인용된 지침 문서의 목차(없으면 쪽) 기준, 상위 10개입니다."
          >
            {stats.topics.length ? (
              <div>
                {stats.topics.map((topic) => (
                  <InfoRow key={topic.name} label={topic.name}>
                    {n(topic.count)}건
                  </InfoRow>
                ))}
              </div>
            ) : (
              <p className="text-sm text-theme-text-secondary">
                이 기간에 인용된 주제가 없습니다.
              </p>
            )}
          </Card>

          <Card
            title="많이 인용된 지침 문서"
            help="답변의 근거로 쓰인 질문 수입니다."
          >
            {stats.documents.cited.length ? (
              <div>
                {stats.documents.cited.map((doc) => (
                  <InfoRow key={doc.name} label={doc.name}>
                    {n(doc.count)}건
                  </InfoRow>
                ))}
              </div>
            ) : (
              <p className="text-sm text-theme-text-secondary">
                이 기간에 인용된 문서가 없습니다.
              </p>
            )}
            <p className="m-0 mt-2 text-sm font-medium text-theme-text-primary">
              이 기간에 한 번도 인용되지 않은 문서
            </p>
            {stats.documents.uncited.length ? (
              <ul className="m-0 list-disc pl-5 text-sm text-theme-text-secondary">
                {stats.documents.uncited.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-theme-text-secondary">없음</p>
            )}
          </Card>

          <Card
            title={`검색 실패 질문 ${n(stats.searchFailures.total)}건`}
            help="답변에 인용된 근거가 한 건도 없었던 질문입니다. 질문 내용과 날짜만 보여주며, 환자 정보로 보이는 숫자는 ***로 가립니다."
          >
            <QuestionList
              items={stats.searchFailures.items}
              total={stats.searchFailures.total}
              empty="이 기간에 해당 질문이 없습니다."
            />
          </Card>

          <Card
            title={`근거 없음 응답 ${n(stats.notFoundAnswers.total)}건`}
            help="근거는 찾았지만 챗봇이 '지침에서 확인되지 않는다'는 취지로 답한 질문입니다. 검색 실패 질문과 겹치지 않습니다."
          >
            <QuestionList
              items={stats.notFoundAnswers.items}
              total={stats.notFoundAnswers.total}
              empty="이 기간에 해당 질문이 없습니다."
            />
          </Card>

          <Card
            title="부서별 사용량"
            help="부서별 질문 수입니다(가나다순). 이 기간 사용자가 5명 미만인 부서는 표시하지 않습니다."
          >
            {stats.departments.length ? (
              <div>
                {stats.departments.map((dept) => (
                  <InfoRow key={dept.name} label={dept.name}>
                    {dept.hidden
                      ? "인원이 적어 표시하지 않음"
                      : `${n(dept.questions)}건`}
                  </InfoRow>
                ))}
              </div>
            ) : (
              <p className="text-sm text-theme-text-secondary">
                이 기간에 질문이 없습니다.
              </p>
            )}
          </Card>

          <Card
            title="대략적인 AI 사용량"
            help="기록된 AI 입력·출력 분량의 합계입니다. 글자 수나 실제 요금이 아니며 일부 사용량은 빠질 수 있습니다."
          >
            <div>
              <InfoRow label="질문 수">{n(stats.aiUsage.questions)}건</InfoRow>
              <InfoRow label="사용량 기록이 있는 답변">
                {n(stats.aiUsage.chatsWithTokens)}건
              </InfoRow>
              <InfoRow label="AI가 읽은 분량">
                {n(stats.aiUsage.promptTokens)}
              </InfoRow>
              <InfoRow label="AI가 작성한 분량">
                {n(stats.aiUsage.completionTokens)}
              </InfoRow>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
