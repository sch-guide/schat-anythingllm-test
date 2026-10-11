import { Help } from './ui';

const AI = {
  normal: ['정상', 'bg-emerald-500'],
  busy: ['일시적 혼잡', 'bg-amber-500'],
  exhausted: ['한도 소진', 'bg-red-500'],
  other: ['확인 필요', 'bg-red-500'],
};
export function SystemLights({ ai, aiError, daily, connections, connectionResult }) {
  const aiState = aiError || ai?.persistenceError ? ['확인 필요', 'bg-amber-500'] : AI[ai?.status] || ['미확인', 'bg-gray-400'];
  const percent = daily?.available && Number.isFinite(daily.count) ? daily.count / 100 : null;
  const connection = connectionResult ? connectionResult.ok ? ['연결 확인됨','bg-emerald-500'] : ['연결 확인 필요','bg-red-500']
    : connections && (!connections.llm?.keySet || !connections.embedding?.keySet) ? ['연결 정보 미등록','bg-amber-500'] : ['미확인','bg-gray-400'];
  const values = [
    ['AI 상태', ...aiState],
    ['오늘 사용량', percent === null ? '미확인' : `${percent.toLocaleString('ko-KR',{maximumFractionDigits:1})}%`, percent === null ? 'bg-gray-400' : percent >= 95 ? 'bg-red-500' : percent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'],
    ['연결 상태', ...connection],
  ];
  return <div className="grid gap-3 sm:grid-cols-3" aria-live="polite">
    {values.map(([label,value,color]) => <div key={label} className="rounded-lg border border-theme-sidebar-border p-3 text-theme-text-primary">
      <p className="text-sm font-medium">{label}{label === '오늘 사용량' && <Help>이 서버에서 기록한 하루 답변 호출 수를 10,000건 기준으로 표시합니다. 다른 서버의 사용량과 실제 잔액은 포함하지 않습니다.</Help>}</p>
      <p className="mt-2 flex items-center gap-2"><span aria-hidden="true" className={`inline-block h-3 w-3 rounded-full ${color}`} />{value}</p>
    </div>)}
  </div>;
}
