// Uses real invocation creation and WebSocket, only in the isolated fixture.
async function requestAgent(token, {cancelMs} = {}) {
  require('./appIsolation.cjs').assertIsolation();
  const response = await fetch('http://127.0.0.1:3001/api/workspace/synthetic-load/stream-chat', {
    method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
    body:JSON.stringify({message:'@agent Synthetic load reference?'}), signal:AbortSignal.timeout(10000)});
  const events = (await response.text()).split('\n\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
  const id = events.find(event=>event.type==='agentInitWebsocketConnection')?.websocketUUID;
  if (!response.ok || !id) throw Error('Agent invocation not created');
  const WebSocket = require('/app/server/node_modules/ws');
  return new Promise((resolve,reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:3001/api/agent-invocation/${id}`);
    const started = performance.now(); let queued=false, waitMs=null, code=null, answer=false, cancelled=false;
    const timeout = setTimeout(()=>{cancelled=cancelMs!=null; code='CLIENT_DEADLINE'; socket.terminate();}, cancelMs??95000);
    socket.on('message', raw => {
      const event = JSON.parse(raw);
      if (event.type==='admissionStatus') {
        if(event.position>0) queued=true;
        else if(waitMs===null) waitMs=performance.now()-started;
      }
      if(event.type==='wssFailure') code=event.errorCode||'UNEXPECTED_ERROR';
      if (['textResponseChunk','fullTextResponse'].includes(event.content?.type) &&
          String(event.content.content).includes('Synthetic fixed answer')) answer=true;
      if(event.type==='WAITING_ON_INPUT') socket.send(JSON.stringify({type:'awaitingFeedback',feedback:'/exit'}));
    });
    socket.on('error', error=>{clearTimeout(timeout); reject(error);});
    socket.on('close',closeCode=>{
      clearTimeout(timeout);
      const normalClose = closeCode === 1000 || closeCode === 1005;
      resolve({code:cancelled?'CLIENT_CANCELLED':code||(!normalClose?'ABNORMAL_CLOSE':answer?'OK':'MISSING_ANSWER'), queued,waitMs,admitted:waitMs!==null,closeCode});
    });
  });
}
module.exports={requestAgent};
