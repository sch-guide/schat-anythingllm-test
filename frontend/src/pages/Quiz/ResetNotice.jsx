import { useEffect, useRef, useState } from "react";
import SchatQuiz from "@/models/schatQuiz";

export default function ResetNotice() {
  const [notice, setNotice] = useState(null);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  async function acknowledge(value) {
    if (pending.current) return;
    pending.current = true;
    const result = await SchatQuiz.acknowledgeReset(value.generation);
    setFailed(!result.success);
    pending.current = false;
  }
  useEffect(() => {
    let active = true;
    SchatQuiz.resetNotice().then((result) => {
      if (!active || !result.success || !result.notice) return;
      setNotice(result.notice);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (notice) acknowledge(notice);
  }, [notice]);
  if (!notice) return null;
  return (
    <div role="status" data-testid="quiz-reset-notice"
      className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200 light:text-sky-800">
      퀴즈 기록이 새로 시작됐어요
      {failed && <div className="mt-2 text-xs">
        안내 확인을 저장하지 못했어요.
        <button type="button" data-testid="quiz-reset-notice-ack" className="ml-2 underline"
          onClick={() => acknowledge(notice)}>다시 저장</button>
      </div>}
    </div>
  );
}
