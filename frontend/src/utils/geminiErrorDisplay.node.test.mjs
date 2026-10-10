import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiErrorDisplay } from './geminiErrorDisplay.js';
test('known Gemini messages are displayed without internal prefixes',()=>{
  const busy='사용자가 많아 잠시 후 다시 시도해 주세요.';
  assert.equal(geminiErrorDisplay(`The agent model failed to respond: ${busy}`),busy);
  const full='현재 AI 사용량이 소진되어 답변할 수 없습니다. 지침서 원본을 확인하시고, 관리자에게 문의해 주세요. 간호교육파트 내선번호 : 6741';
  assert.equal(geminiErrorDisplay(`Gemini Failed to embed: [failed_to_embed]: ${full}`),full);
});
test('unrelated errors are preserved, and generic quota words never imply exhaustion',()=>{
  assert.equal(geminiErrorDisplay('429 quota exceeded'),'429 quota exceeded');
  assert.equal(geminiErrorDisplay('다른 오류'),'다른 오류');
});
