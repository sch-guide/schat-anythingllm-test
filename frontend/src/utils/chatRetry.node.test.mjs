import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retryableTimeout, retryQuestion} from './chatRetry.mjs';
import {updateAdmission, admissionPosition, generationStartedAt} from './chatAdmissionDisplay.mjs';
import {waitingPhase} from './schatWaitingStatus.js';
test('queue then search then writing uses admission clock, never queue time', () => {
  let history = updateAdmission([{role:'user',content:'question'}], 2, 1000);
  assert.equal(admissionPosition(history),2);
  assert.equal(generationStartedAt(history),null);
  history = updateAdmission(history,0,14000);
  assert.equal(admissionPosition(history),null);
  assert.equal(waitingPhase(history),'search');
  history.push({type:'statusResponse',role:'assistant',phase:'answer'});
  assert.equal(waitingPhase(history),'answer');
  assert.equal(generationStartedAt(history),14000);
});
test('both timeout transports permit retry but quota errors and older turns do not', () => {
  for (const errorCode of ['SCHAT_QUEUE_TIMEOUT', 'SCHAT_GENERATION_TIMEOUT'])
    assert.equal(retryableTimeout([{role:'user',content:'question'}, {role:'assistant',errorCode}]), true);
  assert.equal(retryableTimeout([{role:'assistant',errorCode:'SCHAT_QUEUE_TIMEOUT'}, {role:'user',content:'new'}]), false);
  assert.equal(retryableTimeout([{role:'user'}, {role:'assistant',errorCode:'RESOURCE_EXHAUSTED'}]), false);
});
test('retry preserves question and attachments without failed answer or old admission clock', () => {
  const input = [{role:'user',content:'old'}, {role:'assistant',content:'old answer'},
    {role:'user',content:'again',attachments:[{name:'test'}],admissionStartedAt:1},
    {role:'assistant',errorCode:'SCHAT_QUEUE_TIMEOUT'}];
  assert.deepEqual(retryQuestion(input), {text:'again',autoSubmit:true,
    history:[...input.slice(0,2),{role:'user',content:'again',attachments:[{name:'test'}]}],attachments:[{name:'test'}]});
  assert.equal(input.length,4);
  assert.equal(retryQuestion([]),null);
});
