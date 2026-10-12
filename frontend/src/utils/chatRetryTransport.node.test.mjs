import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {updateAdmission} from './chatAdmissionDisplay.mjs';
import {retryableTimeout} from './chatRetry.mjs';
import {waitingPhase} from './schatWaitingStatus.js';

function load(file, name, globals = {}) {
  const source = fs.readFileSync(new URL(file, import.meta.url),'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm,'')
    .replace(/export default function/g,'function').replace(/export /g,'')
    .replace(/import\.meta\.env/g,'({})');
  const context = vm.createContext({...globals, console});
  vm.runInContext(source + `\nthis.handler=${name};`,context);
  return context.handler;
}
test('actual HTTP handler retains timeout code and advances normal writing phase', () => {
  const handle = load('./chat/index.js','handleChat', {updateAdmission,
    getAgentSessionActive: () => false, emitAssistantMessageCompleteEvent: () => {}});
  let displayed;
  const history = [{role:'user',content:'synthetic question'}];
  const set = value => {displayed = value;};
  const send = event => handle(event,()=>{},set,history.slice(0,1),history,()=>{});
  send({type:'admissionStatus',position:0});
  assert.equal(waitingPhase(displayed),'search');
  send({type:'generationPhase',phase:'answer'});
  assert.equal(waitingPhase(displayed),'answer');
  send({type:'abort',errorCode:'SCHAT_QUEUE_TIMEOUT',error:'safe message',close:true});
  assert.equal(retryableTimeout(displayed),true);
  assert.equal(displayed[0].content,'synthetic question');
});
test('actual Agent handler keeps retry information after failure and trailing status', () => {
  const handle = load('./chat/agent.js','handleSocketResponse', {
    updateAdmission, safeJsonParse: JSON.parse, v4: () => 'synthetic-id'});
  let history = [{role:'user',content:'synthetic question'}];
  const set = value => {history = typeof value === 'function' ? value(history) : value;};
  handle({}, {data:JSON.stringify({type:'wssFailure',content:'safe message',errorCode:'SCHAT_GENERATION_TIMEOUT'})},set);
  history.push({type:'statusResponse',content:'Agent session complete.'});
  assert.equal(retryableTimeout(history),true);
});

test('Agent 다음 입력 대기는 완료 상태이며 도구 승인 대기는 실행 상태를 유지함', () => {
  const handle = load('./chat/agent.js','handleSocketResponse', {
    updateAdmission, safeJsonParse: JSON.parse, v4: () => 'synthetic-id'});
  let history = updateAdmission([{role:'user',content:'시험 질문'}],0,100);
  const set = value => { history = typeof value === 'function' ? value(history) : value; };
  const send = event => handle({}, {data:JSON.stringify(event)},set);
  send({type:'toolApprovalRequest',requestId:'r',skillName:'safe-tool'});
  assert.notEqual(history[0].generationComplete,true);
  send({type:'WAITING_ON_INPUT',question:'feedback'});
  assert.equal(history[0].generationComplete,true);
  assert.equal(history.some(item => item.animate),false);
  send({type:'admissionStatus',position:0});
  assert.equal(history[0].generationComplete,false);
  assert.ok(history[0].admissionStartedAt > 100);
});

test('HTTP 닫힌 답변은 저장 완료 이벤트를 기다리지 않고 대기를 끝냄', () => {
  const handle = load('./chat/index.js','handleChat', {updateAdmission,
    getAgentSessionActive: () => false, emitAssistantMessageCompleteEvent: () => {}});
  const history = [{role:'user',content:'시험 질문'}];
  let loading = true;
  const send = close => handle({uuid:'a',type:'textResponseChunk',textResponse:'답변',close}, value => loading=value,()=>{},history.slice(0,1),history,()=>{});
  send(false);
  assert.equal(loading,true);
  send(true);
  assert.equal(loading,false);
});

test('HTTP 늦은 오류는 같은 회차의 닫힌 답변을 덮지 않고 부분 답변 실패는 표시함', () => {
  for (const close of [true,false]) {
    const handle = load('./chat/index.js','handleChat', {updateAdmission,
      getAgentSessionActive: () => false, emitAssistantMessageCompleteEvent: () => {}});
    const history = [{role:'user',content:'시험 질문'}];
    let displayed;
    const send = event => handle(event,()=>{},value=>displayed=value,history.slice(0,1),history,()=>{});
    send({uuid:'a',type:'textResponseChunk',textResponse:'시험 답변',close,error:false});
    send({type:'abort',error:'fake timeout',close:true});
    assert.equal(displayed.at(-1).content,close?'시험 답변':undefined);
    assert.equal(!!displayed.at(-1).error,!close);
  }
});
