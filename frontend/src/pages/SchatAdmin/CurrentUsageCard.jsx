import { useEffect, useState } from "react";
import SchatAdmin from "@/models/schatAdmin";
import { Card, InfoRow } from "./ui";

const n = (value) =>
  Number.isFinite(value) ? value.toLocaleString("ko-KR") : "-";

// "현재 사용 중": SCHAT이 지금 실제로 쓰는 자료 현황만 보여줌.
// 삭제 후보 같은 정리 정보는 넣지 않음.
// 서버는 등록 문서·체크리스트가 바뀌었을 때만 다시 계산함.
export function CurrentUsageRows({ current }) {
  return (
    <div data-testid="current-usage">
      <InfoRow label="등록 문서">{n(current.documents)}개</InfoRow>
      <InfoRow label="총 페이지">{n(current.pages)}쪽</InfoRow>
      <InfoRow label="검색 데이터">
        본문 {n(current.bodyVectors)} · 이미지 설명 {n(current.imageVectors)}
      </InfoRow>
      <InfoRow label="체크리스트">{n(current.checklists)}개</InfoRow>
    </div>
  );
}

export default function CurrentUsageCard() {
  const [current, setCurrent] = useState(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load(refresh = false) {
    setRefreshing(refresh);
    const report = await SchatAdmin.storageReport({ refresh });
    setRefreshing(false);
    if (!report?.summary?.current) return setFailed(true);
    setFailed(false);
    setCurrent(report.summary.current);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <Card
      title="현재 사용 중"
      help={[
        "지금 SCHAT 검색과 답변에 실제로 쓰는 자료 현황이에요.",
        "처음 계산에는 20초쯤 걸릴 수 있어요.",
      ]}
    >
      {current ? (
        <CurrentUsageRows current={current} />
      ) : (
        <p className="text-sm text-theme-text-secondary">
          {failed
            ? "현황을 불러오지 못했어요. 다시 계산해 주세요."
            : "현황을 계산하는 중이에요..."}
        </p>
      )}
      <button
        type="button"
        className="mt-2 self-start text-xs text-sky-600 underline disabled:opacity-50"
        disabled={refreshing}
        onClick={() => load(true)}
      >
        {refreshing ? "다시 계산하는 중..." : "다시 계산"}
      </button>
    </Card>
  );
}
