// Fresh isolated full-app fixture. Optional real-time workload, fake provider only.
const fs = require('node:fs');
const {spawn, execFileSync} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');
require('./appIsolation.cjs').assertIsolation();
if (fs.readdirSync('/app/server/storage').length) throw Error('Storage must start empty');
const env = {PATH: process.env.PATH, HOME: '/tmp', NODE_ENV: 'production',
  CHECKPOINT_DISABLE: '1', DISABLE_TELEMETRY: 'true', STORAGE_DIR: '/app/server/storage',
  SCHAT_ISOLATED_APP_TEST: 'explicit-local-only',
  JWT_SECRET: randomBytes(32).toString('hex'), SIG_KEY: randomBytes(32).toString('hex'),
  SIG_SALT: randomBytes(32).toString('hex'), SERVER_PORT: '3001',
  LLM_PROVIDER: 'gemini', GEMINI_LLM_MODEL_PREF: 'gemini-3.8-flash',
  EMBEDDING_ENGINE: 'gemini', VECTOR_DB: 'chroma', CHROMA_ENDPOINT: 'http://127.0.0.1:8000'};
const withChat = process.env.SCHAT_TEST_CHAT === '1';
const delaySeconds = Number(process.env.SCHAT_TEST_DELAY_SECONDS || 5);
if (![5,10,20].includes(delaySeconds)) throw Error('Unsupported fake delay');
env.SCHAT_TEST_DELAY_SECONDS = String(delaySeconds);
if(process.env.SCHAT_TEST_DB_TRACE === '1') env.SCHAT_TEST_DB_TRACE='1';
if (withChat) env.GEMINI_API_KEY = 'isolated-not-a-real-key';
for (const args of [['generate'], ['migrate', 'deploy']]) {
  execFileSync(process.execPath, ['/app/server/node_modules/prisma/build/index.js', ...args,
    '--schema=/app/server/prisma/schema.prisma'], {env, cwd: '/app/server', stdio: 'inherit'});
}
const {PrismaClient} = require('/app/server/node_modules/@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const password = randomBytes(24).toString('hex');
  const hash = require('/app/server/node_modules/bcryptjs').hashSync(password, 10);
  await prisma.system_settings.create({data: {label: 'multi_user_mode', value: 'true'}});
  const workspace = await prisma.workspaces.create({data: {name: 'Synthetic load workspace', slug: 'synthetic-load'}});
  for (let i = 0; i < 51; i++) {
    const user = await prisma.users.create({data: {username: `load-user-${i}`, password: hash,
      role: i === 0 ? 'admin' : 'default', seen_recovery_codes: true}});
    await prisma.workspace_users.create({data: {user_id: user.id, workspace_id: workspace.id}});
  }
  await prisma.$disconnect();
  if (withChat) {
    const {ChromaClient} = require('/app/server/node_modules/chromadb');
    const client = new ChromaClient({path: env.CHROMA_ENDPOINT});
    for (let i = 0; ; i++) {
      try { await client.heartbeat(); break; }
      catch (error) { if (i >= 30) throw error; await delay(1000); }
    }
    const collection = await client.createCollection({name: 'synthetic-load', metadata: {'hnsw:space': 'cosine'}});
    await collection.add({ids: ['synthetic-chunk-1'], embeddings: [[1, 0, 0]],
      documents: ['Synthetic load reference. Synthetic fixed answer.'],
      metadatas: [{title: 'Synthetic reference', docId: 'synthetic-doc', docSource: 'synthetic.txt', page: 1}]});
  }
  const child = spawn(process.execPath, ['--require', '/tests/appPreload.cjs', '/app/server/index.js'],
    {cwd: '/app/server', env, stdio: ['ignore', 'pipe', 'pipe']});
  let databaseError = false;
  for (const output of [child.stdout, child.stderr]) {
    let tail = '';
    output.on('data', chunk => {
      const combined = tail + chunk.toString();
      if (combined.includes('prisma:error')) databaseError = true;
      tail = combined.slice(-8192);
      process.stdout.write(chunk);
    });
  }
  try {
    let ready = false;
    for (let i = 0; i < 90; i++) {
      if (child.exitCode !== null) throw Error('App exited during boot');
      try { ready = (await fetch('http://127.0.0.1:3001/api/ping', {signal: AbortSignal.timeout(1000)})).ok; } catch {}
      if (ready) break;
      await delay(1000);
    }
    if (!ready) throw Error('App startup timeout');
    let adminToken, employees = 0;
    const tokens = [];
    for (let i = 0; i < 51; i++) {
      const response = await fetch('http://127.0.0.1:3001/api/request-token', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: `load-user-${i}`, password}), signal: AbortSignal.timeout(10000)});
      const result = await response.json();
      if (!response.ok || !result.valid || !result.token) throw Error(`Synthetic login failed: ${i}`);
      if (i === 0) adminToken = result.token; else { employees++; tokens.push(result.token); }
    }
    const response = await fetch('http://127.0.0.1:3001/api/schat-admin/chat-admission', {
      headers: {Authorization: `Bearer ${adminToken}`}, signal: AbortSignal.timeout(10000)});
    const state = await response.json();
    if (!response.ok || state.active !== 0 || state.waiting !== 0) throw Error('Unexpected admission state');
    if (withChat) {
      const {requestChat} = require('./appRequest.cjs');
      const chat = await requestChat(tokens[0]);
      if (chat.code !== 'OK' || !chat.sourceFound) throw Error('Chat smoke failed');
      console.log(JSON.stringify({scope: 'full-app-chat-smoke', fakeAnswer: true, sourceFound: chat.sourceFound}));
      const {requestAgent} = require('./appAgentRequest.cjs');
      const agent = await requestAgent(tokens[1]);
      console.log(JSON.stringify({scope:'full-app-agent-smoke', ...agent}));
      if (agent.code !== 'OK') throw Error('Agent smoke failed');
      const running = requestChat(tokens[2], {cancelMs:2000});
      await delay(250);
      const duplicate = await requestChat(tokens[2]);
      const cancelled = await running;
      const cancelledAgent = await requestAgent(tokens[3], {cancelMs:1000});
      const failed = await requestChat(tokens[4], {message:'Synthetic load reference SCHAT_SYNTHETIC_FAILURE'});
      if (failed.code !== 'UNEXPECTED_ERROR' || !failed.admitted)
        throw Error('Synthetic provider failure did not exercise admitted error path');
      console.log(JSON.stringify({scope:'full-app-provider-error',code:failed.code,admitted:failed.admitted}));
      await delay(1000);
      const recoveredResponse = await fetch('http://127.0.0.1:3001/api/schat-admin/chat-admission', {
        headers:{Authorization:`Bearer ${adminToken}`}, signal:AbortSignal.timeout(10000)});
      const recovered = await recoveredResponse.json();
      const savedAgent = await prisma.workspace_chats.count({where:{user_id:3, response:{not:'{}'}}});
      const emptyCancelled = await prisma.workspace_chats.count({where:{user_id:5,response:'{}'}});
      const openInvocations = await prisma.workspace_agent_invocations.count({where:{closed:false}});
      if(openInvocations !== 0) throw Error('Agent invocation remained open after completion/cancellation');
      if(savedAgent !== 1 || emptyCancelled !== 0) throw Error('Agent saved/empty row preservation failed');
      console.log(JSON.stringify({scope:'full-app-cancel-duplicate', duplicate:duplicate.code,
        httpCancel:cancelled.code, agentCancel:cancelledAgent.code, active:recovered.active, waiting:recovered.waiting}));
      if (duplicate.code !== 'SCHAT_DUPLICATE' || cancelled.code !== 'CLIENT_CANCELLED' ||
          cancelledAgent.code !== 'CLIENT_CANCELLED' || !recoveredResponse.ok || recovered.active !== 0 || recovered.waiting !== 0)
        throw Error('Cancellation or duplicate admission invariant failed');
    }
    if (process.env.SCHAT_TEST_REALISTIC === '1' || process.env.SCHAT_TEST_STRESS === '1') {
      const {requestChat} = require('./appRequest.cjs');
      const {runRealistic, summarize} = require('./realisticWorkload.cjs');
      let completed = 0, peakMemory = 0, peakSwap = 0;
      let peakActive = 0, peakWaiting = 0, samplingError = false, samplePending = false;
      const admissionSample = setInterval(async () => {
        if(samplePending) return;
        samplePending=true;
        try {
          const response=await fetch('http://127.0.0.1:3001/api/schat-admin/chat-admission', {
            headers:{Authorization:`Bearer ${adminToken}`},signal:AbortSignal.timeout(3000)});
          const value=await response.json();
          if(!response.ok || !Number.isInteger(value.active) || !Number.isInteger(value.waiting)) throw Error('Bad sample');
          peakActive=Math.max(peakActive,value.active); peakWaiting=Math.max(peakWaiting,value.waiting);
        } catch {samplingError=true;} finally {samplePending=false;}
      }, 500);
      const read = name => Number(fs.readFileSync('/sys/fs/cgroup/'+name,'utf8').trim());
      const cpu = () => Number(fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8').match(/usage_usec (\d+)/)[1]);
      const started = Date.now(), firstCpu = cpu();
      const sample = setInterval(() => {
        peakMemory = Math.max(peakMemory, read('memory.current'));
        peakSwap = Math.max(peakSwap, read('memory.swap.current'));
      }, 200);
      const progress = setInterval(() => console.log(JSON.stringify({scope:'realistic-progress',completed, elapsedSeconds:(Date.now()-started)/1000})), 15000);
      let rows;
      try {
        if(process.env.SCHAT_TEST_STRESS === '1') {
          rows=[]; let next=0;
          await Promise.all(tokens.map(async token=>{
            for(;;) {
              const index=next++; if(index>=1000) break;
              const start=performance.now();
              const result=await requestChat(token,index%17===0?{cancelMs:2000}:{});
              rows.push({...result,elapsedMs:performance.now()-start,phase:'stress'}); completed++;
              await delay(250);
            }
          }));
        } else rows = await runRealistic({accounts:tokens, rounds:2, request:token=>requestChat(token), onResult:()=>completed++});
      } finally { clearInterval(sample); clearInterval(progress); clearInterval(admissionSample); }
      while (samplePending) await delay(50);
      await delay(500);
      const finalResponse = await fetch('http://127.0.0.1:3001/api/schat-admin/chat-admission', {
        headers:{Authorization:`Bearer ${adminToken}`}, signal:AbortSignal.timeout(10000)});
      const final = await finalResponse.json();
      if (!finalResponse.ok || !Number.isInteger(final.active) || !Number.isInteger(final.waiting))
        throw Error('Final admission status could not be verified');
      const successfulTimes=rows.filter(row=>row.code==='OK').map(row=>row.elapsedMs).sort((a,b)=>a-b);
      const p95=successfulTimes[Math.max(0,Math.ceil(successfulTimes.length*.95)-1)]??null;
      console.log(JSON.stringify({scope:process.env.SCHAT_TEST_STRESS==='1'?'full-app-stress':'full-app-realistic-normal-chat', fakeDelaySeconds:delaySeconds,
        elapsedMs:Date.now()-started, initial:summarize(rows.filter(row=>row.phase==='initial')),
        repeat:summarize(rows.filter(row=>row.phase==='repeat')), total:summarize(rows),
        peakMemory, peakSwap, cpuPercentOfTwoCores:(cpu()-firstCpu)/1000/(Date.now()-started)/2*100,
        peakActive,peakWaiting,samplingError,successfulP95Ms:p95,
        missingSources:rows.filter(row=>row.code==='OK'&&!row.sourceFound).length,
        finalActive:final.active, finalWaiting:final.waiting, realGeminiCalls:0}));
      if (samplingError || peakActive>4 || peakWaiting>10 || final.active !== 0 || final.waiting !== 0 || rows.some(row=>!['OK','SCHAT_QUEUE_FULL','SCHAT_QUEUE_TIMEOUT','CLIENT_CANCELLED'].includes(row.code) || (row.code==='OK'&&!row.sourceFound)))
        throw Error('Full app realistic invariants failed');
    }
    console.log(JSON.stringify({scope: 'full-app-bootstrap-summary', employees, admin: 1,
      initialActive: state.active, initialWaiting: state.waiting, realGeminiCalls: 0,
      chatSmokeTested:withChat, realisticTested:process.env.SCHAT_TEST_REALISTIC === '1'}));
  } finally {
    child.kill('SIGTERM');
    const ended = await Promise.race([new Promise(resolve => child.once('exit', () => resolve(true))), delay(5000, false)]);
    if (!ended) child.kill('SIGKILL');
    if (databaseError) throw Error('Database error detected in isolated app logs; not a passing run');
  }
}
main().catch(error => {console.error(error.message); process.exitCode = 1;}).finally(() => prisma.$disconnect());
