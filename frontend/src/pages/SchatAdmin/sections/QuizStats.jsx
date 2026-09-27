import { useEffect, useState } from "react";
import SchatQuiz from "@/models/schatQuiz";
import { Badge, Card, InfoRow, Loading, Notice } from "../ui";

// 퀴즈 통계: aggregates for improving questions and education. There is no
// per-person result, ranking or leaderboard here, and departments with fewer
// than the minimum number of respondents show no averages.
export default function QuizStats() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    SchatQuiz.stats().then((s) => setStats(s?.ok ? s : { error: true }));
  }, []);
  if (!stats) return <Loading />;
  if (stats.error)
    return <Notice tone="warning">통계를 불러오지 못했습니다.</Notice>;

  const rateTone = (rate) =>
    rate < 50 ? "danger" : rate < 70 ? "warning" : "ok";
  return (
    <div className="flex flex-col gap-y-4" data-testid="quiz-stats">
      <Notice>
        문제 품질 개선과 교육 지원을 위한 집계입니다. 직원 개인별 점수나 순위는
        보여 주지 않습니다.
      </Notice>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="전체 현황">
          <div>
            <InfoRow label="완료한 퀴즈">
              {stats.totals.completedAttempts}회
            </InfoRow>
            <InfoRow label="제출된 답">{stats.totals.answers}개</InfoRow>
            <InfoRow label="전체 정답률">{stats.totals.rate}%</InfoRow>
          </div>
        </Card>
        <Card title="주제별 정답률">
          <div>
            {stats.topics.length === 0 ? (
              <p className="text-sm text-theme-text-secondary">
                아직 풀이 기록이 없습니다.
              </p>
            ) : (
              stats.topics.map((t) => (
                <InfoRow key={t.topic} label={t.topic}>
                  {t.rate}% (답 {t.answers}개)
                </InfoRow>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card
        title="자주 틀리는 문항"
        description="답이 3개 이상 모인 문항 중 정답률이 낮은 순서입니다. 문제 표현이 모호한지, 교육이 더 필요한 내용인지 확인해 보세요."
      >
        {stats.mostMissed.length === 0 ? (
          <p className="text-sm text-theme-text-secondary">
            아직 충분한 풀이 기록이 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col" data-testid="quiz-most-missed">
            {stats.mostMissed.map((q) => (
              <li
                key={q.questionId}
                className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-theme-sidebar-border last:border-b-0"
              >
                <span className="min-w-0 flex-1 text-sm text-theme-text-primary">
                  <span className="line-clamp-2">{q.question}</span>
                  <span className="block text-xs text-theme-text-secondary">
                    #{q.questionId} · {q.topic} · p.{q.page} · 답 {q.answers}개
                  </span>
                </span>
                <Badge tone={rateTone(q.rate)}>정답률 {q.rate}%</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="부서별 통계"
        description={`응답자가 ${stats.minRespondents}명 이상인 부서만 평균을 표시합니다. 퀴즈를 완료할 때의 부서 기준이며, 부서 순위는 만들지 않습니다.`}
      >
        {stats.departments.length === 0 ? (
          <p className="text-sm text-theme-text-secondary">
            아직 완료한 퀴즈가 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full min-w-[560px] text-sm text-left"
              data-testid="quiz-departments"
            >
              <thead className="text-xs text-theme-text-secondary border-b border-theme-sidebar-border">
                <tr>
                  <th className="py-2 pr-3 font-medium">부서</th>
                  <th className="py-2 pr-3 font-medium">응답자</th>
                  <th className="py-2 pr-3 font-medium">평균 점수</th>
                  <th className="py-2 pr-3 font-medium">평균 정답률</th>
                  <th className="py-2 font-medium">많이 틀린 주제</th>
                </tr>
              </thead>
              <tbody>
                {stats.departments.map((d) => (
                  <tr
                    key={d.department}
                    className="border-b border-theme-sidebar-border last:border-b-0"
                  >
                    <td className="py-2 pr-3 text-theme-text-primary">
                      {d.department}
                    </td>
                    {d.enough ? (
                      <>
                        <td className="py-2 pr-3">{d.respondents}명</td>
                        <td className="py-2 pr-3">{d.averageScore}점</td>
                        <td className="py-2 pr-3">{d.averageRate}%</td>
                        <td className="py-2 text-theme-text-secondary">
                          {d.mostWrongTopics.map((t) => t.topic).join(", ") ||
                            "-"}
                        </td>
                      </>
                    ) : (
                      <td
                        colSpan={4}
                        className="py-2 text-theme-text-secondary"
                      >
                        응답자 {stats.minRespondents}명 미만 · 표시하지 않음
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="문항별 정답률">
        {stats.perQuestion.length === 0 ? (
          <p className="text-sm text-theme-text-secondary">
            아직 풀이 기록이 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm text-left">
              <thead className="text-xs text-theme-text-secondary border-b border-theme-sidebar-border">
                <tr>
                  <th className="py-2 pr-3 font-medium">번호</th>
                  <th className="py-2 pr-3 font-medium">문제</th>
                  <th className="py-2 pr-3 font-medium">주제</th>
                  <th className="py-2 pr-3 font-medium">답</th>
                  <th className="py-2 font-medium">정답률</th>
                </tr>
              </thead>
              <tbody>
                {stats.perQuestion.map((q) => (
                  <tr
                    key={q.questionId}
                    className="border-b border-theme-sidebar-border last:border-b-0"
                  >
                    <td className="py-2 pr-3 text-theme-text-secondary">
                      {q.questionId}
                    </td>
                    <td className="py-2 pr-3 text-theme-text-primary max-w-[420px]">
                      <span className="line-clamp-1">{q.question}</span>
                    </td>
                    <td className="py-2 pr-3 text-theme-text-secondary">
                      {q.topic}
                    </td>
                    <td className="py-2 pr-3 text-theme-text-secondary">
                      {q.answers}
                    </td>
                    <td className="py-2">{q.rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
