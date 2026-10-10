// Fixed isolated loopback endpoint only. Never accepts a production URL.
async function requestChat(token, {cancelMs, message = 'Synthetic load reference?'} = {}) {
  require('./appIsolation.cjs').assertIsolation();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cancelMs ?? 95000);
  const started = performance.now();
  let queued = false, waitMs = null, code = null, answer = '', sourceFound = false;
  try {
    const response = await fetch('http://127.0.0.1:3001/api/workspace/synthetic-load/stream-chat', {
      method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
      body:JSON.stringify({message, mode:'query'}), signal:controller.signal});
    if (!response.ok) throw Error(`Unexpected HTTP ${response.status}`);
    let buffer = ''; const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, {stream:true});
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0,boundary); buffer = buffer.slice(boundary+2);
        if (!frame.startsWith('data: ')) continue;
        const event = JSON.parse(frame.slice(6));
        if (event.type === 'admissionStatus') {
          if (event.position > 0) queued = true;
          else if (waitMs === null) waitMs = performance.now()-started;
        }
        if (event.error) code = event.errorCode || 'UNEXPECTED_ERROR';
        if (event.textResponse) answer += event.textResponse;
        if (JSON.stringify(event.sources || []).includes('Synthetic reference')) sourceFound = true;
      }
    }
    code ||= answer.includes('Synthetic fixed answer') ? 'OK' : 'MISSING_ANSWER';
    return {code, queued, waitMs, admitted:waitMs !== null, sourceFound};
  } catch (error) {
    if (controller.signal.aborted && cancelMs != null)
      return {code:'CLIENT_CANCELLED', queued, waitMs, admitted:waitMs !== null};
    throw error;
  } finally { clearTimeout(timer); }
}
module.exports = {requestChat};
