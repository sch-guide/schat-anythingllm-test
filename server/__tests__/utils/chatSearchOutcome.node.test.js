const test = require('node:test');
const assert = require('node:assert/strict');
let api = {};
try { api = require('../../utils/chatSearchOutcome'); } catch {}

test('새 답변은 출처 개수와 무관하게 완료 상태를 저장하며 빈 임시 응답은 보존', () => {
  assert.equal(typeof api.withSearchOutcome, 'function');
  assert.deepEqual(api.withSearchOutcome({}), {});
  for (const response of [
    { text: '정상 안내입니다.', sources: [] },
    { text: '못 찾으면 담당 부서에 문의하세요. 절차는 먼저 신청서를 작성하세요.', sources: [] },
    { text: '정상 안내입니다.', sources: [], cached: true },
  ]) assert.deepEqual(api.withSearchOutcome(response).searchOutcome, { version: 2, status: 'answered' });
});

test('완전한 근거 없음 응답만 실패, 빈 답변과 오류·중단은 판정 불가', () => {
  assert.equal(typeof api.withSearchOutcome, 'function');
  for (const text of ['등록된 문서에서 확인되지 않습니다.', '관련 근거를 찾지 못했습니다.', '죄송합니다. 등록된 병원 문서에서 답변을 찾을 수 없습니다.'])
    assert.equal(api.withSearchOutcome({ text, sources: [] }).searchOutcome.status, 'not_found', text);
  for (const response of [{ text: '' }, { text: '답변 일부', error: 'timeout' }, { text: '답변 일부', aborted: true }, { text: '답변 일부', searchOutcome: {version: 2, status: 'unknown'} }])
    assert.equal(api.withSearchOutcome(response).searchOutcome.status, 'unknown');
  assert.equal(api.withSearchOutcome({text:'사용자 지정 거절 문구', searchOutcome:{version:2,status:'not_found'}}).searchOutcome.status, 'not_found');
});
