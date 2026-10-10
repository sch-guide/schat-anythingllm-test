const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
function fixture() {
  let socket, timeout;
  class Socket extends EventEmitter {
    constructor() {super(); socket=this;}
    send(raw) {this.sent=JSON.parse(raw); this.emit('close',1000);}
    terminate() {this.emit('close');}
  }
  const sandbox = {module:{exports:{}}, performance, AbortSignal,
    setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>{},
    fetch:async()=>({ok:true,text:async()=> 'data: {"type":"agentInitWebsocketConnection","websocketUUID":"test-id"}\n\n'}),
    require:name=>name==='./appIsolation.cjs'?{assertIsolation(){}}:Socket};
  vm.runInNewContext(fs.readFileSync(require.resolve('./appAgentRequest.cjs'),'utf8'),sandbox);
  return {request:sandbox.module.exports.requestAgent, getSocket:()=>socket, deadline:()=>timeout()};
}
test('Agent exits feedback wait with the required protocol message', async()=>{
  const f=fixture(); const pending=f.request('test'); await new Promise(setImmediate);
  const socket=f.getSocket();
  socket.emit('message',JSON.stringify({type:'reportStreamEvent',content:{type:'textResponseChunk',content:'Synthetic fixed answer'}}));
  socket.emit('message',JSON.stringify({type:'WAITING_ON_INPUT'}));
  assert.equal(socket.sent.type,'awaitingFeedback');
  assert.equal(socket.sent.feedback,'/exit');
  assert.equal((await pending).code,'OK');
});
test('Agent client deadline after text is not reported as successful completion', async()=>{
  const f=fixture(); const pending=f.request('test'); await new Promise(setImmediate);
  f.getSocket().emit('message',JSON.stringify({type:'reportStreamEvent',content:{type:'textResponseChunk',content:'Synthetic fixed answer'}}));
  f.deadline(); assert.equal((await pending).code,'CLIENT_DEADLINE');
});

test('Agent abnormal close after text is not a successful answer', async()=>{
  const f=fixture(); const pending=f.request('test'); await new Promise(setImmediate);
  f.getSocket().emit('message',JSON.stringify({type:'reportStreamEvent',content:{type:'textResponseChunk',content:'Synthetic fixed answer'}}));
  f.getSocket().emit('close',1006);
  assert.equal((await pending).code,'ABNORMAL_CLOSE');
});
