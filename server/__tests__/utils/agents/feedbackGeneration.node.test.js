const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function setup() {
  const events = [];
  const timers = new Map();
  let timerId = 0, released = 0, admitted = 0;
  const deps = {
    chalk: { red: x => x, yellow: x => x }, uuid: { v4: () => 'fake-id' },
    '../../../../models/telemetry': { Telemetry: { sendTelemetry: async () => {} } },
    '../../../http': { safeJsonParse: JSON.parse },
    '../../../helpers/agents': { skillIsAutoApproved: () => false },
    '../../../middleware/multiUserProtected': { ROLES: {} },
    '../../../../models/agentSkillWhitelist': { AgentSkillWhitelist: { isWhitelisted: async () => false } },
    '../../../chats/commands/img': { generateImage: async () => ({ textResponse: 'synthetic image', outputs: [] }) },
    '../../../files': { generatedImageAttachments: () => [] },
    '../../../../models/user': { User: {} },
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../utils/agents/aibitat/plugins/websocket.js'), 'utf8'), {
    module: mod, process: { env: {} }, console,
    setTimeout: fn => {timers.set(++timerId,fn);return timerId;}, clearTimeout: id => timers.delete(id),
    require: name => {if (!(name in deps))throw Error(name);return deps[name];},
  });
  const socket = {
    OPEN: 1, readyState: 1, send: data => events.push(JSON.parse(data)),
    completeGeneration: () => released++,
    runGeneration: async work => { admitted++; return work(); },
  };
  const ai = { emitter: new EventEmitter(), handlerProps: { invocation: {workspace:{id:1}} },
    onError(){}, onMessage(){}, onTerminate(){}, onInterrupt(fn){this.interrupt=fn;},
    continue: async () => {},
  };
  mod.exports.websocket.plugin({socket}).setup(ai);
  return {ai,socket,events,timers,counts:()=>({released,admitted})};
}

test('Agent 실제 피드백 처리의 완료와 다음 입력은 해제/재입장 경계를 거침', async () => {
  const f=setup();
  const work=f.ai.interrupt({to:'agent',from:'USER'});
  assert.equal(f.counts().released,1);
  await f.socket.handleFeedback(JSON.stringify({type:'awaitingFeedback',feedback:'시험 질문'}));
  await work;
  assert.equal(f.counts().admitted,1);
});

test('Agent 대기 중 이미지 생성도 재입장하고 완료 후 자리를 해제함', async () => {
  const f=setup();
  const work=f.socket.askForFeedback(f.socket,{to:'agent',from:'USER'});
  await f.socket.handleFeedback(JSON.stringify({type:'awaitingFeedback',feedback:'/img synthetic'}));
  assert.deepEqual(f.counts(),{released:2,admitted:1});
  assert.equal(f.events.at(-1).type,'WAITING_ON_INPUT');
  await f.socket.handleFeedback(JSON.stringify({type:'awaitingFeedback',feedback:'exit'}));
  await work;
});

test('Agent 도구 승인과 확인 질문은 생성 완료로 처리하지 않음', async () => {
  const f=setup();
  const approval=f.ai.requestToolApproval({skillName:'fake-tool'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.counts().released,0);
  f.socket.handleToolApproval(JSON.stringify({type:'toolApprovalResponse',requestId:'fake-id',approved:false}));
  await approval;
  const clarification=f.ai.requestUserClarification({questions:[{question:'synthetic'}]});
  assert.equal(f.counts().released,0);
  f.socket.handleClarificationResponse(JSON.stringify({type:'clarificationResponse',requestId:'fake-id',skipped:true}));
  await clarification;
});
