const {fixture}=require('./documentUpdateFixture');
const {executeDocumentUpdate}=require('../../utils/documentUpdates/service');
const pause=async()=>{process.send('paused');await new Promise(()=>{});};
// Keep the child alive even when the selected operation awaits a pending promise.
setInterval(()=>{},1000);
(async()=>{
  const f=await fixture({after(){}},{root:process.argv[2],resume:true,persistent:true});
  const phase=process.argv[3];
  const fs=require('node:fs/promises'),path=require('node:path');
  if(phase.startsWith('journal-write:') || phase.startsWith('journal-partial:')) {
    const name=phase.split(':')[1],open=fs.open;
    fs.open=async(...args)=>{
      const handle=await open(...args);
      if(path.basename(String(args[0])).includes(name)) {
        if(phase.startsWith('journal-write:'))await pause();
        else {
          const write=handle.writeFile.bind(handle);
          handle.writeFile=async value=>{await write(String(value).slice(0,12));await pause();};
        }
      }
      return handle;
    };
  }
  if(phase.startsWith('journal-published:')) {
    const name=phase.split(':')[1],link=fs.link;
    fs.link=async(...args)=>{await link(...args);if(path.basename(String(args[1]))===name)await pause();};
  }
  if(phase==='catalog-publication' || phase==='catalog-published') {
    const copy=fs.copyFile,link=fs.link;
    const isCatalog=filename=>path.dirname(String(filename))===path.join(f.root,'documents','custom-documents');
    fs.copyFile=async(...args)=>{
      if(isCatalog(args[1])) {
        const handle=await fs.open(args[1],'wx');await handle.writeFile('{"partial":');await handle.close();await pause();
      }
      return copy(...args);
    };
    fs.link=async(...args)=>{
      if(isCatalog(args[1])&&phase==='catalog-publication')await pause();
      await link(...args);
      if(isCatalog(args[1])&&phase==='catalog-published')await pause();
    };
  }
  if(phase==='preparation') {
    const run=f.deps.collector.processDocument;
    f.deps.collector.processDocument=async(...args)=>{await run(...args);return pause();};
  }
  if(phase==='retire') {
    const run=f.live.delete;
    f.live.delete=async args=>{await run(args);if(args.ids.includes('old-vector'))await pause();};
  }
  if(phase==='committed') {
    const run=f.deps.guard.acquire.bind(f.deps.guard);
    f.deps.guard.acquire=async(...args)=>{const release=await run(...args);return async()=>{await pause();await release();};};
  }
  if(phase==='recovery') {
    const run=f.live.upsert;
    f.live.upsert=async args=>{await run(args);await pause();};
    await require('../../utils/documentUpdates/recovery').recoverDocumentUpdates(f.deps);
  } else await executeDocumentUpdate(f.request,f.deps);
})().catch(error=>{console.error(error);process.exit(1);});
