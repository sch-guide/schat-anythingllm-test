// 새 기록에만 붙이는 검색 결과. 과거 기록은 읽을 때 재분류하지 않는다.
function readSearchOutcome(response) {
  const outcome = response?.searchOutcome;
  if (outcome?.version !== 2) return null;
  return ['answered', 'not_found', 'unknown'].includes(outcome.status)
    ? outcome.status : 'unknown';
}

// 문장 전체가 거절인 경우만 판정한다. 본문 일부의 '찾지 못했다'는 제외한다.
const FULL_REFUSAL = /^(?:죄송합니다[.!]?\s*)?(?:(?:등록된|제공된)\s+(?:병원\s+)?(?:문서|지침)(?:에서|에는?|에서는?)\s*)?(?:(?:관련\s+)?(?:답변|내용|정보|근거)(?:을|를|가|는)?\s*)?(?:확인되지 않습니다|찾을 수 없습니다|찾지 못했습니다|없습니다)[.!]?$/u;

function withSearchOutcome(response = {}) {
  if (!response || typeof response !== 'object' || Array.isArray(response))
    return response;
  // Agent 임시 행 삭제는 response === '{}'에 의존한다.
  if (Object.keys(response).length === 0) return response;
  let status = readSearchOutcome(response);
  if (!status) {
    const text = typeof response.text === 'string' ? response.text.trim() : '';
    if (!text || response.error || response.aborted || response.interrupted || response.timedOut)
      status = 'unknown';
    else status = FULL_REFUSAL.test(text) ? 'not_found' : 'answered';
  }
  return { ...response, searchOutcome: { version: 2, status } };
}

module.exports = { withSearchOutcome, readSearchOutcome };
