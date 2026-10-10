// Test-only HTTP adapter, NOT the SCHAT application or its login/RAG routes.
// No provider SDK, credentials, database, documents or production switches.
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { createAdmission } = require('../../server/utils/chatAdmission');
const { openSession } = require('../../server/utils/chatAdmissionSession');

async function createHarness({ delayMs = 5000, maxActive = 4 } = {}) {
  const gate = createAdmission();
  gate.configure({maxActive});
  const stats = { admitted: 0, completed: 0, cancelled: 0, maxActive: 0, maxWaiting: 0 };
  const server = http.createServer(async (req, res) => {
    const user = Number(req.headers['x-synthetic-user']);
    const send = value => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(value) + '\n'); };
    if (!Number.isInteger(user) || user < 1 || user > 50) {
      res.end(JSON.stringify({code: 'UNAUTHORIZED'}) + '\n'); return;
    }
    let session;
    try {
      session = await openSession(gate, user, res, {
        onPosition: position => {
          stats.maxWaiting = Math.max(stats.maxWaiting, gate.snapshot().waiting);
          send({position});
        },
      });
      session.check();
      stats.admitted++;
      stats.maxActive = Math.max(stats.maxActive, gate.snapshot().active);
      send({position: 0});
      // Two fake operations: embedding then answer. Combined delay is delayMs.
      await delay(Math.min(20, delayMs), null, {signal: session.signal});
      session.check();
      const vector = [0, 1, 0];
      await delay(Math.max(0, delayMs - 20), null, {signal: session.signal});
      session.check();
      send({code: 'OK', answer: 'Synthetic fixed answer', vector});
      stats.completed++;
    } catch (error) {
      const code = session?.signal.aborted ? session.signal.reason?.code : error.code;
      if (code === 'SCHAT_CANCELLED') stats.cancelled++;
      send({code: code || 'UNEXPECTED_ERROR'});
    } finally {
      session?.release();
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {gate, stats, port: server.address().port,
    close: () => new Promise(resolve => server.close(resolve))};
}

function request(port, user, cancelMs = null) {
  return new Promise(resolve => {
    const positions = [];
    let buffer = '', timer, result, done = false;
    const finish = code => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({...result, code: result?.code || code, positions});
    };
    const req = http.get({host: '127.0.0.1', port, path: '/',
      headers: {'x-synthetic-user': String(user)}, agent: false}, res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        let boundary;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          try {
            const event = JSON.parse(buffer.slice(0, boundary));
            if ('position' in event) positions.push(event.position);
            if (event.code) result = event;
          } catch { finish('INVALID_RESPONSE'); }
          buffer = buffer.slice(boundary + 1);
        }
      });
      res.on('end', () => finish('EMPTY_RESPONSE'));
      res.on('error', () => finish('TRANSPORT_ERROR'));
    });
    req.on('error', () => finish('TRANSPORT_ERROR'));
    req.setTimeout(125000, () => { finish('CLIENT_TIMEOUT'); req.destroy(); });
    if (cancelMs !== null) timer = setTimeout(() => {
      finish('CLIENT_CANCELLED'); req.destroy();
    }, cancelMs);
  });
}
module.exports = { createHarness, request };
