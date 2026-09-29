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
import { Card, InfoRow, Loading, Notice } from "../ui";

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

  useEffect(() => {
    setStats(null);
    SchatAdmin.usageStats(period).then((result) =>
      setStats(result || { error: true })
    );
  }, [period]);

  return (
    <div className="flex flex-col gap-y-5">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="기간">
        {USAGE_PERIODS.map(([key, label]) => (
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

      {!stats ? (
        <Loading />
      ) : stats.error ? (
        <Notice tone="warning">통계를 불러오지 못했습니다.</Notice>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Card
              title={`질문 수 ${n(stats.questions.total)}건`}
              description="직원이 SCHAT에 물어본 질문 수입니다. 시간은 한국 시간 기준입니다."
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
            description="답변에 인용된 지침 문서의 목차(없으면 쪽) 기준, 상위 10개입니다."
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
            description="답변의 근거로 쓰인 질문 수입니다."
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
            description="답변에 인용된 근거가 한 건도 없었던 질문입니다. 질문 내용과 날짜만 보여주며, 환자 정보로 보이는 숫자는 ***로 가립니다."
          >
            <QuestionList
              items={stats.searchFailures.items}
              total={stats.searchFailures.total}
              empty="이 기간에 해당 질문이 없습니다."
            />
          </Card>

          <Card
            title={`근거 없음 응답 ${n(stats.notFoundAnswers.total)}건`}
            description="근거는 찾았지만 챗봇이 '지침에서 확인되지 않는다'는 취지로 답한 질문입니다. 검색 실패 질문과 겹치지 않습니다."
          >
            <QuestionList
              items={stats.notFoundAnswers.items}
              total={stats.notFoundAnswers.total}
              empty="이 기간에 해당 질문이 없습니다."
            />
          </Card>

          <Card
            title="부서별 사용량"
            description="부서별 질문 수입니다(가나다순). 이 기간 사용자가 5명 미만인 부서는 표시하지 않습니다."
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
            description="답변할 때 저장된 Gemini 토큰 수의 합계입니다. 금액은 계산하지 않습니다."
          >
            <div>
              <InfoRow label="질문 수">{n(stats.aiUsage.questions)}건</InfoRow>
              <InfoRow label="토큰 기록이 있는 답변">
                {n(stats.aiUsage.chatsWithTokens)}건
              </InfoRow>
              <InfoRow label="입력 토큰">
                {n(stats.aiUsage.promptTokens)}
              </InfoRow>
              <InfoRow label="출력 토큰">
                {n(stats.aiUsage.completionTokens)}
              </InfoRow>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
