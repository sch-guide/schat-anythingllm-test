const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const context = new AsyncLocalStorage();
const retainedJobs = new Set();
const readerOwners=new Map();
const processOwner = {
  version: 1,
  pid: process.pid,
  host: os.hostname(),
  token: randomUUID(),
};
if(process.platform==='linux') {
  try {
    const sync=require('node:fs');
    processOwner.bootId=sync.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
    const stat=sync.readFileSync('/proc/self/stat','utf8');
    processOwner.start=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
  } catch { /* Without kernel identity, recovery remains conservative. */ }
}

async function ownerHasExited(raw) {
  let owner;
  try { owner = JSON.parse(raw); } catch { throw new Error('DOCUMENT_UPDATE_OWNER_UNVERIFIED'); }
  // A PID alone cannot establish ownership across machines or containers.
  // Legacy/incomplete records stay locked for explicit recovery inspection.
  if (owner?.version !== 1 || owner.host !== processOwner.host ||
      !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string' || !owner.token)
    throw new Error('DOCUMENT_UPDATE_OWNER_UNVERIFIED');
  try {
    process.kill(owner.pid, 0);
    if(process.platform==='linux' && owner.bootId && owner.start && processOwner.bootId) {
      if(owner.bootId!==processOwner.bootId)return true;
      const stat=await fs.readFile(`/proc/${owner.pid}/stat`,'utf8');
      if(stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]!==owner.start)return true;
    }
    return false;
  }
  catch (error) {
    if (error.code === 'ESRCH' || error.code === 'ENOENT') return true;
    throw new Error('DOCUMENT_UPDATE_OWNER_UNVERIFIED');
  }
}

async function releaseAll(releases) {
  const errors = [];
  for (const release of [...releases].reverse()) {
    try { await release(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'DOCUMENT_UPDATE_UNLOCK_REQUIRED');
}
async function readerOwner(root) {
  if(process.platform!=='linux')return processOwner;
  if(!readerOwners.has(root))readerOwners.set(root,(async()=>{
    const directory=path.join(root,'owners',processOwner.token);
    await fs.mkdir(directory,{recursive:true});
    const lease=await require('./ownerLease').acquireOwnerLease(directory,{unref:true});
    return lease;
  })());
  (await readerOwners.get(root)).assertActive();
  return {...processOwner,evidence:'process-flock'};
}
async function writeReader(root,filename,record) {
  const staging=path.join(root,`reader-pending-${randomUUID()}`);
  await fs.writeFile(staging,JSON.stringify(record),{flag:'wx'});
  await fs.rename(staging,filename);
}

class UpdateGuard {
  constructor(root,ownerRoot=root) { this.root = root; this.ownerRoot=ownerRoot; this.lock = path.join(root, 'exclusive'); }
  scoped(keys) {
    if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== 'string' || !key || key.length > 4096))
      throw new Error('DOCUMENT_UPDATE_INVALID_SCOPE');
    return [...new Set(keys)].sort().map(key => new UpdateGuard(path.join(this.root, 'scopes', createHash('sha256').update(key).digest('hex')),this.ownerRoot));
  }
  async acquireRead(job, keys) {
    const releases = [];
    try {
      for (const scoped of keys ? this.scoped(keys) : [this]) {
        const directory = path.join(scoped.root, 'readers');
        await fs.mkdir(directory, {recursive:true});
        const filename = path.join(directory, randomUUID());
        await writeReader(scoped.root,filename,{...processOwner,job});
        releases.push(() => fs.unlink(filename));
        try { await fs.stat(scoped.lock); throw new Error('DOCUMENT_UPDATE_LOCKED'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      return () => releaseAll(releases);
    } catch (error) { await releaseAll(releases); throw error; }
  }
  async read(operation, keys) {
    if (keys) {
      try { await fs.stat(this.lock); throw new Error('DOCUMENT_UPDATE_LOCKED'); }
      catch(error) {if(error.code!=='ENOENT')throw error;}
      const guards = this.scoped(keys);
      const next = index => index === guards.length ? operation() : guards[index].read(() => next(index + 1));
      return next(0);
    }
    if (context.getStore()?.has(this.root)) return operation();
    const readers = path.join(this.root, 'readers');
    await fs.mkdir(readers, { recursive: true });
    const lease = path.join(readers, randomUUID());
    await writeReader(this.root,lease,await readerOwner(this.ownerRoot));
    try {
      try { await fs.stat(this.lock); throw new Error('DOCUMENT_UPDATE_LOCKED'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      return await this.owned(operation);
    } finally { await fs.unlink(lease); }
  }
  async readWhenAvailable(operation, keys, { signal, timeoutMs = 30000 } = {}) {
    const started = Date.now();
    while (true) {
      signal?.throwIfAborted();
      // Retry only acquisition, never an operation that already began.
      let entered = false;
      try { return await this.read(() => { entered = true; return operation(); }, keys); }
      catch (error) {
        if (entered || error.message !== 'DOCUMENT_UPDATE_LOCKED' || Date.now() - started >= timeoutMs) throw error;
        await delay(25, undefined, { signal });
      }
    }
  }
  async acquireWhenAvailable(job, keys, { signal, timeoutMs = 30000 } = {}) {
    const started = Date.now();
    while (true) {
      signal?.throwIfAborted();
      try { return await this.acquire(job, keys); }
      catch (error) {
        if (!['DOCUMENT_UPDATE_LOCKED', 'DOCUMENT_UPDATE_BUSY'].includes(error.message) || Date.now() - started >= timeoutMs) throw error;
        await delay(25, undefined, { signal });
      }
    }
  }
  async acquire(job, keys) {
    if (keys) {
      try { await fs.stat(this.lock); throw new Error('DOCUMENT_UPDATE_LOCKED'); }
      catch(error) {if(error.code!=='ENOENT')throw error;}
      const releases = [];
      try {
        for (const scoped of this.scoped(keys)) releases.push(await scoped.acquire(job));
      } catch (error) {
        try { await releaseAll(releases); }
        catch (releaseError) { throw new AggregateError([error, releaseError], 'DOCUMENT_UPDATE_UNLOCK_REQUIRED'); }
        throw error;
      }
      return () => releaseAll(releases);
    }
    return this.#claim(job);
  }
  async #claim(job, allowReaders = false, recoveryFor = null) {
    if (typeof job !== 'string' || !job || job.length > 1024) throw new Error('DOCUMENT_UPDATE_INVALID_JOB');
    await fs.mkdir(this.root, { recursive: true });
    try {await fs.stat(this.lock);throw new Error('DOCUMENT_UPDATE_LOCKED');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const staging=path.join(this.root,`pending-${randomUUID()}`);
    await fs.mkdir(staging);
    let published=false;
    const ownerRecord = JSON.stringify({ ...processOwner, lease: randomUUID(),...(recoveryFor?{recoveryFor}:{}) });
    try {
      await fs.writeFile(path.join(staging, 'job'), job, { flag: 'wx' });
      await fs.writeFile(path.join(staging, 'owner'), ownerRecord, { flag: 'wx' });
      try {await fs.rename(staging,this.lock);published=true;}
      catch(error) {
        if(await fs.stat(this.lock).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))throw new Error('DOCUMENT_UPDATE_LOCKED');
        throw error;
      }
      const readers = await fs.readdir(path.join(this.root, 'readers')).catch(error => {
        if (error.code === 'ENOENT') return []; throw error;
      });
      if (!allowReaders)for(const name of readers) {
        const filename=path.join(this.root,'readers',name);
        const raw=await fs.readFile(filename,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(!raw)continue;
        const owner=JSON.parse(raw);
        // Update workspace leases require their journal repair, never a reap.
        if(owner.job)throw new Error('DOCUMENT_UPDATE_BUSY');
        let proof=null;
        try {
          if(owner.host===processOwner.host) {
            if(!await ownerHasExited(raw))throw new Error('DOCUMENT_UPDATE_BUSY');
          } else {
            if(process.platform!=='linux' || owner.evidence!=='process-flock' || !/^[a-f0-9-]{36}$/.test(owner.token))throw new Error('DOCUMENT_UPDATE_OWNER_UNVERIFIED');
            const directory=path.join(this.ownerRoot,'owners',owner.token);
            await fs.stat(path.join(directory,'owner.lock'));
            try{proof=await require('./ownerLease').acquireOwnerLease(directory);}
            catch(error){if(error.message==='DOCUMENT_UPDATE_OWNER_ACTIVE')throw new Error('DOCUMENT_UPDATE_BUSY');throw error;}
          }
          if(await fs.readFile(filename,'utf8')!==raw)throw new Error('DOCUMENT_UPDATE_LOCK_OWNER_CHANGED');
          await fs.unlink(filename);
        } finally {if(proof)await proof.release();}
      }
    } catch (error) {
      await fs.rm(published?this.lock:staging, { recursive: true });
      throw error;
    }
    return async () => {
      if ((await fs.readFile(path.join(this.lock, 'job'), 'utf8')) !== job ||
          (await fs.readFile(path.join(this.lock, 'owner'), 'utf8')) !== ownerRecord)
        throw new Error('DOCUMENT_UPDATE_LOCK_OWNER_CHANGED');
      await fs.rm(this.lock, { recursive: true });
    };
  }
  async recover(job, keys, verify, {ownerToken=null}={}) {
    if (typeof verify !== 'function') throw new Error('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
    const guards = keys ? this.scoped(keys) : [this];
    const claimed = [];
    try {
      for (const scoped of guards) {
        let currentJob;
        try { currentJob = await fs.readFile(path.join(scoped.lock,'job'),'utf8'); }
        catch(error) {
          if(error.code!=='ENOENT') throw error;
          // Persist the verified job lease lineage only for a lock that this
          // recovery creates. Never retrofit proof onto an unknown owner.
          await scoped.#claim(job,false,ownerToken?{version:1,job,ownerToken}:null);
          retainedJobs.add(job);
          currentJob=job;
        }
        if (currentJob !== job)
          throw new Error('DOCUMENT_UPDATE_LOCK_OWNER_CHANGED');
        const owner = await fs.readFile(path.join(scoped.lock, 'owner'), 'utf8');
        const record=JSON.parse(owner);
        const inheritedProof=ownerToken && record.recoveryFor?.version===1 && record.recoveryFor.job===job && record.recoveryFor.ownerToken===ownerToken;
        if (!(ownerToken && record.token===ownerToken) && !inheritedProof && !(retainedJobs.has(job) && record.token===processOwner.token) && !await ownerHasExited(owner)) throw new Error('DOCUMENT_UPDATE_OWNER_ACTIVE');
        let marker = path.join(scoped.lock, 'recovery');
        // An immutable chain avoids unlink/recreate races between two rescuers.
        // Only a proven dead claim can be followed, and wx elects one successor.
        while (true) {
          try { await fs.writeFile(marker, JSON.stringify(processOwner), { flag: 'wx' }); break; }
          catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const previous = await fs.readFile(marker, 'utf8');
            if (!ownerToken && !await ownerHasExited(previous)) throw new Error('DOCUMENT_UPDATE_RECOVERY_BUSY');
            marker = path.join(scoped.lock, `recovery-${createHash('sha256').update(marker + previous).digest('hex')}`);
          }
        }
        claimed.push({ scoped, owner, marker });
      }
      if (await verify({ job, keys: keys ? [...keys] : null }) !== true)
        throw new Error('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
      for (const { scoped, owner } of claimed) {
        if (await fs.readFile(path.join(scoped.lock, 'owner'), 'utf8') !== owner ||
            await fs.readFile(path.join(scoped.lock, 'job'), 'utf8') !== job)
          throw new Error('DOCUMENT_UPDATE_LOCK_OWNER_CHANGED');
      }
      for (const { scoped } of claimed) await fs.rm(scoped.lock, { recursive: true });
      retainedJobs.delete(job);
    } finally {
      for (const { marker } of claimed) {
        await fs.unlink(marker).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    }
  }
  async releaseJobReaders(job,keys,{ownerToken=null}={}) {
    for(const scoped of this.scoped(keys)) {
      const directory=path.join(scoped.root,'readers');
      const names=await fs.readdir(directory).catch(error=>{if(error.code==='ENOENT')return[];throw error;});
      for(const name of names) {
        const filename=path.join(directory,name);
        const raw=await fs.readFile(filename,'utf8');
        const owner=JSON.parse(raw);
        if(owner.job!==job)continue;
        if(!(ownerToken&&owner.token===ownerToken) && !(retainedJobs.has(job)&&owner.token===processOwner.token) && !await ownerHasExited(raw)) throw new Error('DOCUMENT_UPDATE_OWNER_ACTIVE');
        if(await fs.readFile(filename,'utf8')!==raw)throw new Error('DOCUMENT_UPDATE_LOCK_OWNER_CHANGED');
        await fs.unlink(filename);
      }
    }
  }
  async recoverReaders(keys, verify) {
    if (typeof verify !== 'function') throw new Error('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
    const guards = keys ? this.scoped(keys) : [this];
    const releases = [];
    const abandoned = [];
    try {
      // Reserve only the requested keys while checking and removing abandoned
      // leases. New readers cannot cross the recovery boundary after the scan.
      for (const scoped of guards) releases.push(await scoped.#claim(`reader-recovery-${randomUUID()}`, true));
      for (const scoped of guards) {
        const directory = path.join(scoped.root, 'readers');
        const names = await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        for (const name of names) {
          const filename = path.join(directory, name);
          const owner = await fs.readFile(filename, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (!owner) continue;
          if (!await ownerHasExited(owner)) throw new Error('DOCUMENT_UPDATE_OWNER_ACTIVE');
          abandoned.push({ filename, owner });
        }
      }
      if (!abandoned.length) return 0;
      if (await verify({ keys: keys ? [...keys] : null, count: abandoned.length }) !== true)
        throw new Error('DOCUMENT_UPDATE_RECOVERY_UNVERIFIED');
      for (const { filename, owner } of abandoned) {
        if (await fs.readFile(filename, 'utf8') !== owner)
          throw new Error('DOCUMENT_UPDATE_LOCK_OWNER_CHANGED');
      }
      for (const { filename } of abandoned) await fs.unlink(filename);
      return abandoned.length;
    } finally { await releaseAll(releases); }
  }
  owned(operation, keys) {
    if (keys) {
      const guards = this.scoped(keys);
      const next = index => index === guards.length ? operation() : guards[index].owned(() => next(index + 1));
      return next(0);
    }
    return context.run(new Set([...(context.getStore() || []), this.root]), operation);
  }
}
function defaultRoot() {
  return path.join(process.env.STORAGE_DIR || path.resolve(__dirname, '../../storage'), 'document-updates', 'guard');
}
const guard = new UpdateGuard(defaultRoot());
async function catalogWriteLease(request,response,operation) {
  try {
    const {documentKey}=require('./scopes');
    const name=request.file?.originalname;
    if(!name)return await operation();
    let metadata=request.body?.metadata;
    if(typeof metadata==='string') {try{metadata=JSON.parse(metadata);}catch{metadata=null;}}
    const names=[name];
    if(typeof metadata?.title==='string' && metadata.title.trim())names.push(metadata.title);
    // Include synchronous scope validation and asynchronous work in one error
    // boundary: Express 4 does not consume a rejected async route promise.
    // A disconnected response does not imply catalog writes have stopped.
    return await guard.read(operation,[...new Set(names.map(documentKey))]);
  } catch(error) {
    if(response.headersSent || response.destroyed || response.writableEnded)return;
    if(error?.message==='DOCUMENT_UPDATE_INVALID_SCOPE')
      return response.status(400).json({success:false,code:'DOCUMENT_UPDATE_INVALID_SCOPE',error:'문서 이름 또는 제목을 확인해 주세요.'});
    if(['DOCUMENT_UPDATE_BUSY','DOCUMENT_UPDATE_LOCKED'].includes(error?.message))
      return response.status(423).json({success:false,code:'DOCUMENT_UPDATE_LOCKED',error:'이 문서는 지금 업데이트 중입니다. 잠시 후 다시 시도해 주세요.'});
    return response.status(500).json({success:false,code:'DOCUMENT_UPLOAD_FAILED',error:'문서 업로드를 완료하지 못했습니다.'});
  }
}
module.exports = { UpdateGuard, guard, catalogWriteLease, processOwner, ownerHasExited, retainedJobs };
