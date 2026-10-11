const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {executeDocumentUpdate}=require('../../utils/documentUpdates/service');
const {UpdateGuard}=require('../../utils/documentUpdates/guard');
const {createAnswerCache}=require('../../utils/answerCache');
const {documentKey,workspaceKey}=require('../../utils/documentUpdates/scopes');

// The SQL store and filesystem are real temporary resources. Only collector
// parsing and Chroma network transport are replaced; no external AI is called.
async function fixture(t,{retireFails=false,restoreFails=false,root:existingRoot=null,resume=false,persistent=false}={}) {
  const root=existingRoot || await fs.mkdtemp(path.join(os.tmpdir(),'schat-update-integration-'));
  const remote=process.env.SCHAT_CHROMA_TEST_URL ? new (require('chromadb').ChromaClient)({path:process.env.SCHAT_CHROMA_TEST_URL}) : null;
  const db=remote ? {exec(){},close(){}} : new (require('node:sqlite').DatabaseSync)(path.join(root,'fixture.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS workspace_documents(id INTEGER PRIMARY KEY, docId TEXT, filename TEXT, docpath TEXT, workspaceId INTEGER, metadata TEXT, pinned INTEGER, watched INTEGER); CREATE TABLE IF NOT EXISTS document_vectors(id INTEGER PRIMARY KEY, docId TEXT, vectorId TEXT)');
  t.after(async()=>{db.close();await fs.rm(root,{recursive:true,force:true});});
  const matches=(row,where={})=>Object.entries(where).every(([k,v])=>v&&typeof v==='object'?v.in.includes(row[k]):row[k]===v);
  const memory={};
  function table(name) {
    if(remote) {
      memory[name]=[];
      return {
        findMany:async({where={}}={})=>structuredClone(memory[name].filter(row=>matches(row,where))),
        create:async({data})=>{memory[name].push({...structuredClone(data),pinned:typeof data.pinned==='boolean'?Number(data.pinned):data.pinned,watched:typeof data.watched==='boolean'?Number(data.watched):data.watched,id:data.id||Math.max(0,...memory[name].map(row=>row.id))+1});},
        update:async({where,data})=>{for(const row of memory[name].filter(row=>matches(row,where)))Object.assign(row,structuredClone(data),{...(typeof data.pinned==='boolean'?{pinned:Number(data.pinned)}:{}),...(typeof data.watched==='boolean'?{watched:Number(data.watched)}:{})});},
        deleteMany:async({where})=>{memory[name]=memory[name].filter(row=>!matches(row,where));},
        upsert:async({where,create,update})=>memory[name].some(row=>matches(row,where))?prisma[name].update({where,data:update}):prisma[name].create({data:create}),
      };
    }
    const all=()=>db.prepare(`SELECT * FROM ${name}`).all();
    return {
      findMany:async({where={}}={})=>all().filter(row=>matches(row,where)),
      create:async({data})=>{const keys=Object.keys(data);db.prepare(`INSERT INTO ${name}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>typeof data[k]==='boolean'?Number(data[k]):data[k]));},
      update:async({where,data})=>{for(const row of all().filter(row=>matches(row,where))){const keys=Object.keys(data);db.prepare(`UPDATE ${name} SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k=>typeof data[k]==='boolean'?Number(data[k]):data[k]),row.id);}},
      deleteMany:async({where})=>{for(const row of all().filter(row=>matches(row,where))) db.prepare(`DELETE FROM ${name} WHERE id=?`).run(row.id);},
      upsert:async({where,create,update})=>{if(all().some(row=>matches(row,where))) await prisma[name].update({where,data:update});else await prisma[name].create({data:create});},
    };
  }
  const prisma={workspace_documents:table('workspace_documents'),document_vectors:table('document_vectors'),schat_quiz_sets:{findMany:async()=>[{id:7,title:'기존 퀴즈',document_id:'old-pdf'}]},workspace_chats:{findMany:async()=>[{id:8,response:JSON.stringify({sources:[{document_id:'old-pdf'}]})}]} };
  prisma.$transaction=async operation=>{db.exec('BEGIN');try{const result=await operation(prisma);db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  await fs.mkdir(path.join(root,'documents','custom-documents'),{recursive:true});
  await fs.mkdir(path.join(root,'original-documents'),{recursive:true});
  if(!resume) {
  await fs.writeFile(path.join(root,'original-documents','old.pdf'),'%PDF-old');
  await fs.writeFile(path.join(root,'documents','custom-documents','old.json'),JSON.stringify({id:'old-page',title:'규정.pdf',document_id:'old-pdf',pageContent:'이전 규정'}));
  await prisma.workspace_documents.create({data:{id:1,docId:'old-row',filename:'old.json',docpath:'custom-documents/old.json',workspaceId:1,metadata:JSON.stringify({document_id:'old-pdf'}),pinned:true,watched:false}});
  await prisma.document_vectors.create({data:{id:1,docId:'old-row',vectorId:'old-vector'}});
  }
  let failed=false;
  const collections=new Map();
  t.after(async()=>{if(remote)for(const name of collections.keys())await remote.deleteCollection({name});});
  function collection(name) {
    if(collections.has(name)) return collections.get(name);
    const records=new Map();
    const connection=()=>remote.getOrCreateCollection({name});
    const disk=path.join(root,`vectors-${name}.json`);
    const sync=require('node:fs');
    const reload=()=>{if(persistent && sync.existsSync(disk)){records.clear();for(const [id,value] of JSON.parse(sync.readFileSync(disk,'utf8')))records.set(id,value);}};
    const save=()=>{if(persistent)sync.writeFileSync(disk,JSON.stringify([...records]));};
    reload();
    const value={records,
      count:async()=>{if(remote)return (await connection()).count();reload();return records.size;},
      get:async({ids,include=[]}={})=>{if(remote){const data=await(await connection()).get({...(ids?{ids}:{}),include});return {ids:data.ids,...Object.fromEntries(include.map(key=>[key,data[key]]))};}reload();const entries=[...records].filter(([id])=>!ids||ids.includes(id));return {ids:entries.map(([id])=>id),...Object.fromEntries(include.map(key=>[key,entries.map(([,r])=>r[key])]))};},
      upsert:async data=>{reload();if(restoreFails&&failed&&data.ids.includes('old-vector'))throw new Error('restore transport failed');if(remote)await(await connection()).upsert(data);data.ids.forEach((id,i)=>records.set(id,{embeddings:data.embeddings[i],documents:data.documents[i],metadatas:data.metadatas[i]}));save();},
      delete:async({ids})=>{reload();if(remote)await(await connection()).delete({ids});ids.forEach(id=>records.delete(id));save();if(retireFails&&ids.includes('old-vector')&&!failed){failed=true;throw new Error('retire transport failed');}},
    };
    collections.set(name,value);return value;
  }
  const namespace=remote?`test-${require('node:crypto').randomUUID()}`:'test';
  const live=collection(namespace);
  if(!resume)await live.upsert({ids:['old-vector'],embeddings:[[1,0]],documents:['이전 규정'],metadatas:[{document_id:'old-pdf'}]});
  const client={getCollection:async({name})=>{if(!collections.has(name))throw new Error('missing collection');return collection(name);},getOrCreateCollection:async({name})=>collection(name),deleteCollection:async({name})=>{if(remote && collections.has(name))await remote.deleteCollection({name});return collections.delete(name);}};
  let sequence=0;
  const cache={stored:null,invalidate(){this.stored=null;},async loadCorpus(c){this.stored=await c.get({include:['metadatas','documents']});return{stored:this.stored};}};
  const answerCache=createAnswerCache();
  answerCache.put({workspaceId:1,question:'synthetic',generation:0,value:{answer:'old'}});
  const deps={root,provider:'chroma',prisma,guard:new UpdateGuard(path.join(root,'guard')),cache,purgeCache:async()=>{},policy:'test',checklists:{listAll:()=>[{id:'c1',title:'기존 체크리스트',documentId:'old-pdf'}]},
    answerCacheRuntime:{beginMutation:ids=>answerCache.beginMutation(ids)},
    preserve:async({documentId})=>fs.writeFile(path.join(root,'original-documents',`${documentId}.pdf`),'%PDF-new'),
    collector:{processDocument:async(filename,metadata,job)=>{
      const directory=path.join(root,'document-updates',job,'documents');await fs.mkdir(directory,{recursive:true});
      const documents=[];
      for(let page=1;page<=2;page++) {
        const id=`new-page-${++sequence}`;const data={...metadata,id,page,pageContent:`새 규정 ${page}`,token_count_estimate:3};
        await fs.writeFile(path.join(directory,`${id}.json`),JSON.stringify(data));
        documents.push({...data,location:`documents/${id}.json`});
      }
      return{success:true,documents};
    }},
    vector:{normalize:x=>x,connect:async()=>({client}),addDocumentToNamespace:async(namespace,data)=>{
      const vectorId=`vector-${data.id}`;
      await collection(namespace).upsert({ids:[vectorId],embeddings:[[0,1]],documents:[data.pageContent],metadatas:[{document_id:data.document_id}]});
      await prisma.document_vectors.create({data:{docId:data.docId,vectorId}});return{vectorized:true};
    }},
  };
  const request={workspace:{id:1,slug:'test'},files:[{originalname:'규정.pdf',filename:'new.pdf',path:'unused'}],manifest:{names:['규정.pdf'],conflicts:[{name:'규정.pdf',documents:[{docpath:'custom-documents/old.json',documentId:'old-pdf'}]}]}};
  request.workspace.slug=namespace;
  return{root,prisma,live,deps,request,collections,answerCache,close:()=>db.close()};
}
module.exports={fixture};
