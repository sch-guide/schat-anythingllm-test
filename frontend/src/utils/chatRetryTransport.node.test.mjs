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
