const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { UpdateGuard } = require('../../utils/documentUpdates/guard');
const { spawnSync } = require('node:child_process');
const {spawn}=require('node:child_process');
const guardModule = require.resolve('../../utils/documentUpdates/guard');

function abandoned(root, mode) {
  const source = `const { UpdateGuard } = require(process.argv[1]);
    const guard = new UpdateGuard(process.argv[2]);
    (async () => {
      if (process.argv[3] === 'writer') await guard.acquire('abandoned-job', ['document:guide.pdf']);
      else await guard.read(() => { process.exit(0); }, ['document:guide.pdf']);
    })().catch(error => { console.error(error); process.exit(1); });`;
  const result = spawnSync(process.execPath, ['-e', source, guardModule, root, mode], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('같은 문서만 잠그고 다른 문서와 다른 작업공간은 계속 처리한다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scoped-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const writer = new UpdateGuard(root);
  const reader = new UpdateGuard(root);
  const release = await writer.acquire('synthetic-job', ['document:guide.pdf', 'workspace:1']);
  try {
    assert.equal(await reader.read(async () => 'other document', ['document:other.pdf']), 'other document');
    assert.equal(await reader.read(async () => 'other workspace', ['workspace:2']), 'other workspace');
    await assert.rejects(reader.read(async () => 'unsafe', ['document:guide.pdf']), /DOCUMENT_UPDATE_LOCKED/);
    await assert.rejects(reader.read(async () => 'unsafe', ['workspace:1']), /DOCUMENT_UPDATE_LOCKED/);
  } finally {
    await release();
  }
});

test('같은 자료의 진행 중 쓰기는 교체를 막지만 다른 자료 교체는 막지 않는다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scoped-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const guard = new UpdateGuard(root);
  let finish;
  const reading = guard.read(() => new Promise(resolve => { finish = resolve; }), ['document:guide.pdf']);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  try {
    const releaseOther = await guard.acquire('other-job', ['document:other.pdf']);
    await releaseOther();
    await assert.rejects(guard.acquire('same-job', ['document:guide.pdf']), /DOCUMENT_UPDATE_BUSY/);
  } finally {
    finish();
    await reading;
  }
});

test('복수 키 중 뒤의 키가 충돌하면 먼저 얻은 키는 풀고 상대 잠금은 보존한다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scoped-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const guard = new UpdateGuard(root);
  const release = await guard.acquire('original', ['document:z.pdf']);
  await assert.rejects(guard.acquire('contender', ['document:a.pdf', 'document:z.pdf']), /DOCUMENT_UPDATE_LOCKED/);
  assert.equal(await guard.read(async () => 'available', ['document:a.pdf']), 'available');
  await assert.rejects(guard.read(async () => 'unsafe', ['document:z.pdf']), /DOCUMENT_UPDATE_LOCKED/);
  await release();
});

test('여러 키를 소유한 작업의 중첩 호출은 자기 잠금을 다시 기다리지 않는다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scoped-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const guard = new UpdateGuard(root);
  const keys = ['document:guide.pdf', 'workspace:1'];
  const release = await guard.acquire('nested', keys);
  try {
    assert.equal(await guard.owned(() => guard.read(() => guard.read(async () => 7, ['workspace:1']), ['document:guide.pdf']), keys), 7);
  } finally { await release(); }
});

test('살아 있는 소유자의 잠금은 복구 검증 함수가 있어도 해제하지 않는다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scoped-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const guard = new UpdateGuard(root);
  const release = await guard.acquire('running-job', ['document:guide.pdf']);
  let inspected = false;
  await assert.rejects(guard.recover('running-job', ['document:guide.pdf'], async () => { inspected = true; return true; }), /DOCUMENT_UPDATE_OWNER_ACTIVE/);
  assert.equal(inspected, false);
  await release();
});

test('중단된 다른 프로세스의 잠금도 복구 상태 확인 실패 시 유지하고 검증 성공 뒤에만 푼다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scoped-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  abandoned(root, 'writer');
  const guard = new UpdateGuard(root);
  assert.equal(await guard.read(async () => 'other', ['document:other.pdf']), 'other');
  await assert.rejects(guard.recover('abandoned-job', ['document:guide.pdf'], async () => false), /DOCUMENT_UPDATE_RECOVERY_UNVERIFIED/);
  await assert.rejects(guard.read(async () => 'unsafe', ['document:guide.pdf']), /DOCUMENT_UPDATE_LOCKED/);
  await guard.recover('abandoned-job', ['document:guide.pdf'], async ({ job }) => job === 'abandoned-job');
  assert.equal(await guard.read(async () => 'recovered', ['document:guide.pdf']), 'recovered');
});

test('명시 복구의 검증이 거부하면 중단된 일반 표식을 보존한다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scoped-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  abandoned(root, 'reader');
  const guard = new UpdateGuard(root);
  await assert.rejects(guard.recoverReaders(['document:guide.pdf'], async () => false), /DOCUMENT_UPDATE_RECOVERY_UNVERIFIED/);
  assert.equal((await fs.readdir(path.join(guard.scoped(['document:guide.pdf'])[0].root,'readers'))).length,1);
  assert.equal(await guard.recoverReaders(['document:guide.pdf'], async () => true), 1);
  const release = await guard.acquire('new-job', ['document:guide.pdf']);
  await release();
});

test('같은 키의 살아 있는 사용 작업이 있으면 중단된 사용 표식 복구도 시작하지 않는다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scoped-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  abandoned(root, 'reader');
  const guard = new UpdateGuard(root);
  let finish;
  const pending = guard.read(() => new Promise(resolve => { finish = resolve; }), ['document:guide.pdf']);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  let inspected = false;
  try {
    await assert.rejects(guard.recoverReaders(['document:guide.pdf'], async () => { inspected = true; return true; }), /DOCUMENT_UPDATE_OWNER_ACTIVE/);
    assert.equal(inspected, false);
  } finally { finish(); await pending; }
  const release=await guard.acquire('new-job', ['document:guide.pdf']);
  await release();
});

test('죽은 소유자라도 복구 검증이 예외로 끝나면 잠금을 남기고 다음 검증을 허용한다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scoped-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  abandoned(root, 'writer');
  const guard = new UpdateGuard(root);
  await assert.rejects(guard.recover('abandoned-job', ['document:guide.pdf'], async () => { throw new Error('synthetic verification failure'); }), /synthetic verification failure/);
  await assert.rejects(guard.read(async () => 'unsafe', ['document:guide.pdf']), /DOCUMENT_UPDATE_LOCKED/);
  await guard.recover('abandoned-job', ['document:guide.pdf'], async () => true);
  assert.equal(await guard.read(async () => 3, ['document:guide.pdf']), 3);
});

test('복구를 동시에 시작하면 두 번째 작업은 첫 번째 검증 중 잠금을 풀지 못한다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-scoped-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  abandoned(root, 'writer');
  const guard = new UpdateGuard(root);
  let finish;
  const pending = guard.recover('abandoned-job', ['document:guide.pdf'], () => new Promise(resolve => { finish = resolve; }));
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  try {
    await assert.rejects(new UpdateGuard(root).recover('abandoned-job', ['document:guide.pdf'], async () => true), /DOCUMENT_UPDATE_RECOVERY_BUSY/);
    await assert.rejects(guard.read(async () => 'unsafe', ['document:guide.pdf']), /DOCUMENT_UPDATE_LOCKED/);
  } finally { finish(true); await pending; }
});

test('복구 프로세스도 종료된 경우 다음 프로세스가 검증을 이어간다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-recovery-restart-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  abandoned(root, 'writer');
  const source = `const {UpdateGuard}=require(process.argv[1]);
    new UpdateGuard(process.argv[2]).recover('abandoned-job',['document:guide.pdf'],async()=>process.exit(0));`;
  const result = spawnSync(process.execPath, ['-e', source, guardModule, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const guard = new UpdateGuard(root);
  await guard.recover('abandoned-job', ['document:guide.pdf'], async () => true);
  assert.equal(await guard.read(async () => 'available', ['document:guide.pdf']), 'available');
});

test('검색 전환 대기는 다른 부서를 막지 않고 취소 신호를 보존한다', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schat-search-wait-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const guard = new UpdateGuard(root);
  const release = await guard.acquire('cutover', ['search:ward-one']);
  const controller = new AbortController();
  const waiting = guard.readWhenAvailable(async () => 'unsafe', ['search:ward-one'], {signal:controller.signal});
  assert.equal(await guard.readWhenAvailable(async () => 'other', ['search:ward-two']), 'other');
  controller.abort();
  await assert.rejects(waiting, error => error.name === 'AbortError');
  const resumed = guard.readWhenAvailable(async () => 'new', ['search:ward-one']);
  await release();
  assert.equal(await resumed, 'new');
});

test('일반 검색 중 프로세스가 죽어도 다음 교체가 안전한 독점 잠금을 얻는다',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schat-abandoned-search-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  abandoned(root,'reader');
  const guard=new UpdateGuard(root);
  const release=await guard.acquire('next-update',['document:guide.pdf']);
  await release();
});

test('Linux 호스트명이 달라진 일반 읽기도 커널 소유권으로 살아 있음과 종료를 구분한다',{skip:process.platform!=='linux'},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schat-reader-container-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=`const {UpdateGuard}=require(process.argv[1]);new UpdateGuard(process.argv[2]).read(async()=>{console.log('ready');setInterval(()=>{},1000);await new Promise(()=>{});},['document:guide.pdf']).catch(error=>{console.error(error);process.exit(1)});`;
  const child=spawn(process.execPath,['-e',source,guardModule,root],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(new Error(`child exit ${code}`)));});
  const guard=new UpdateGuard(root);
  const directory=path.join(guard.scoped(['document:guide.pdf'])[0].root,'readers');
  const filename=path.join(directory,(await fs.readdir(directory))[0]);
  const owner=JSON.parse(await fs.readFile(filename,'utf8'));
  owner.host='previous-isolated-container';
  await fs.writeFile(filename,JSON.stringify(owner));
  await assert.rejects(guard.acquire('next',['document:guide.pdf']),/DOCUMENT_UPDATE_BUSY/);
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});
  const release=await guard.acquireWhenAvailable('next',['document:guide.pdf']);
  await release();
});

for(const phase of ['before','after'])test(`독점 잠금 원자 게시 ${phase} 강제 종료도 소유자 없는 잠금을 만들지 않는다`,async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schat-lock-publication-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=`const fs=require('node:fs/promises');const path=require('node:path');const rename=fs.rename;
    fs.rename=async(...args)=>{if(path.basename(args[1])==='exclusive'&&process.argv[3]==='before')process.exit(0);await rename(...args);if(path.basename(args[1])==='exclusive')process.exit(0);};
    new(require(process.argv[1]).UpdateGuard)(process.argv[2]).acquire('abandoned-job',['document:guide.pdf']).catch(error=>{console.error(error);process.exit(1)});`;
  const result=spawnSync(process.execPath,['-e',source,guardModule,root,phase],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const guard=new UpdateGuard(root);
  if(phase==='after')await guard.recover('abandoned-job',['document:guide.pdf'],async()=>true);
  const release=await guard.acquire('next',['document:guide.pdf']);await release();
});

test('업로드 연결이 닫혀도 실제 처리 완료 전에는 같은 문서 교체를 허용하지 않는다',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schat-upload-lifetime-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const guard=new UpdateGuard(root);
  const shared=require('../../utils/documentUpdates/guard');
  const original=shared.guard.read;shared.guard.read=guard.read.bind(guard);
  let begin,complete,done=false;
  const started=new Promise(resolve=>begin=resolve),processing=new Promise(resolve=>complete=resolve);
  const response=new(require('node:events').EventEmitter)();response.headersSent=true;
  const work=shared.catalogWriteLease({file:{originalname:'guide.pdf'}},response,async()=>{begin();await processing;done=true;});
  try {
    await started;response.emit('close');
    await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(done,false);
    let escapedRelease;
    try {await assert.rejects(async()=>{escapedRelease=await guard.acquire('replace',['document:guide.pdf']);},/DOCUMENT_UPDATE_BUSY/);}
    finally {if(escapedRelease)await escapedRelease();}
  } finally {complete();await work;shared.guard.read=original;}
  const release=await guard.acquire('after-upload',['document:guide.pdf']);await release();
});

test('복구가 추가한 잠금도 최초 작업 증명으로 호스트명 변경 후 재복구한다',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schat-recovery-ownership-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  abandoned(root,'writer');
  const guard=new UpdateGuard(root);
  const original=JSON.parse(await fs.readFile(path.join(guard.scoped(['document:guide.pdf'])[0].lock,'owner'),'utf8'));
  const source=`require('node:os').hostname=()=> 'previous-recovery-container';
    new(require(process.argv[1]).UpdateGuard)(process.argv[2]).recover('abandoned-job',['document:guide.pdf','search:test'],async()=>process.exit(0),{ownerToken:process.argv[3]}).catch(error=>{console.error(error);process.exit(1)});`;
  const result=spawnSync(process.execPath,['-e',source,guardModule,root,original.token],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  await guard.recover('abandoned-job',['document:guide.pdf','search:test'],async()=>true,{ownerToken:original.token});
  assert.equal(await guard.read(async()=>true,['search:test']),true);
});

test('업로드 API 사용자 제목도 교체와 같은 문서 키로 보호한다',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'schat-upload-title-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const guard=new UpdateGuard(root),shared=require('../../utils/documentUpdates/guard');
  const original=shared.guard.read;shared.guard.read=guard.read.bind(guard);
  let blocked=false;
  try {
    await shared.catalogWriteLease({file:{originalname:'source.pdf'},body:{metadata:'{"title":"guide.pdf"}'}},{headersSent:true},async()=>{
      let escaped;
      try {escaped=await guard.acquire('replace',['document:guide.pdf']);}
      catch(error) {blocked=error.message==='DOCUMENT_UPDATE_BUSY';}
      finally {if(escaped)await escaped();}
    });
    assert.equal(blocked,true);
  } finally {shared.guard.read=original;}
});
