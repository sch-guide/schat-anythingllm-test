// Run only in a network=none Docker container, never against an external URL.
const fs = require('node:fs');
const {setTimeout: delay} = require('node:timers/promises');
const {createHarness, request} = require('./admissionHarness.cjs');
const read = file => { try {return fs.readFileSync(file, 'utf8').trim();} catch {return null;} };
async function main() {
  if (!process.argv.includes('--isolated-load-test') || !fs.existsSync('/.dockerenv'))
    throw Error('Run explicitly inside isolated Docker only');
  const routes = read('/proc/net/route');
  if (!routes || routes.split('\n').slice(1).some(line => line.trim().split(/\s+/)[1] === '00000000'))
    throw Error('A default network route is present: refuse test');
  if (Object.keys(process.env).some(key => /API_KEY|TOKEN|PASSWORD|DATABASE_URL/.test(key)))
    throw Error('Credentials are not allowed in this fixture');
  const seconds = Number(process.argv[2]);
  if (![5,10,20].includes(seconds)) throw Error('Delay must be 5, 10 or 20 seconds');
  const total = 5000;
  const app = await createHarness({delayMs: seconds * 1000});
  const codes = {}, allMs = [], successfulMs = [];
  let next = 0, finished = 0, peakMemory = 0, peakSwap = 0;
  const started = Date.now(), cpu = process.cpuUsage();
  const sample = setInterval(() => {
    peakMemory = Math.max(peakMemory, Number(read('/sys/fs/cgroup/memory.current')) || 0);
    peakSwap = Math.max(peakSwap, Number(read('/sys/fs/cgroup/memory.swap.current')) || 0);
  }, 100);
  const progress = setInterval(() => console.log(JSON.stringify({progress: finished, total, ...app.gate.snapshot()})), 10000);
  try {
    await Promise.all(Array.from({length: 50}, (_, index) => (async () => {
      for (;;) {
        const sequence = next++;
        if (sequence >= total) break;
        const at = Date.now();
        const reply = await request(app.port, index + 1, sequence % 17 === 0 ? 2000 : null);
        const elapsed = Date.now() - at;
        allMs.push(elapsed);
        if (reply.code === 'OK') successfulMs.push(elapsed);
        codes[reply.code] = (codes[reply.code] || 0) + 1;
        finished++;
        // Prevent rejected workers from burning through 5,000 in milliseconds.
        await delay(250);
      }
    })()));
    await delay(100);
    const final = app.gate.snapshot();
    const used = process.cpuUsage(cpu), elapsedMs = Date.now() - started;
    const percentile = (values, p) => values.length ? [...values].sort((a,b)=>a-b)[Math.min(values.length-1, Math.floor(values.length*p))] : null;
    console.log(JSON.stringify({scope: 'admission-http-fixture-not-full-schat', seconds, total, codes,
      elapsedMs, p95AllMs: percentile(allMs,.95), p95SuccessfulMs: percentile(successfulMs,.95),
      cpuPercentOfTwoCores: (used.user+used.system)/1000/elapsedMs/2*100,
      peakMemory, peakSwap, memoryLimit: read('/sys/fs/cgroup/memory.max'),
      cpuLimit: read('/sys/fs/cgroup/cpu.max'), stats: app.stats, final}, null, 2));
    const expectedCodes = ['OK', 'CLIENT_CANCELLED', 'SCHAT_QUEUE_FULL', 'SCHAT_QUEUE_TIMEOUT', 'SCHAT_DUPLICATE'];
    if (finished !== total || final.active || final.waiting || Object.keys(codes).some(code => !expectedCodes.includes(code)) || app.stats.maxActive > 4 || app.stats.maxWaiting > 10)
      process.exitCode = 1;
  } finally { clearInterval(sample); clearInterval(progress); await app.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
