const { createHash, randomBytes } = require('node:crypto');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const emptyCounts = () => ({chats:0,quizSets:0,quizQuestions:0,quizRuns:0,checklists:0,workspaces:0,search:0,images:0});

// Only counts and a one-way change marker leave this function. No question,
// answer, account or patient text is returned or logged.
function collectOriginalReferences(input) {
  const entries=new Map();
  function add(documentId, kind, identity, count=1) {
    if(typeof documentId!=='string' || !documentId.trim()) return;
    const key=hash(documentId.trim());
    if(!entries.has(key)) entries.set(key,{counts:emptyCounts(),identities:[]});
    const entry=entries.get(key);
    entry.counts[kind]+=count;
    entry.identities.push(`${kind}:${identity}:${count}`);
  }
  function documentIds(value, ids=new Set()) {
    if(!value || typeof value!=='object') return ids;
    if(typeof value.document_id==='string') ids.add(value.document_id.trim());
    for(const child of Object.values(value)) documentIds(child,ids);
    return ids;
  }
  try {
    for(const chat of input.chats) {
      const response=JSON.parse(chat.response);
      if(!response || typeof response!=='object') return null;
      for(const id of documentIds(response)) add(id,'chats',chat.id);
    }
    for(const kind of ['quizSets','quizQuestions','quizRuns'])
      for(const row of input[kind]) add(row.document_id,kind,row.id);
    for(const [id,count] of input.checklists) add(id,'checklists','count',count);
    for(const id of input.workspaceDocumentIds) add(id,'workspaces','linked');
    for(const id of input.chromaDocumentIds) add(id,'search','linked');
    for(const folder of input.imageFolders) add(folder.name,'images','linked');
    for(const kind of ['checklists','workspaces','search','images']) {
      const rows=input.referenceIdentities?.[kind];
      if(!Array.isArray(rows)) return null;
      const matched=new Map();
      for(const row of rows) {
        if(!['string','number'].includes(typeof row.id) || String(row.id).trim()==='' || typeof row.document_id!=='string') return null;
        const key=hash(row.document_id.trim());
        matched.set(key,(matched.get(key)||0)+1);
        add(row.document_id,kind,JSON.stringify(row.id),0);
      }
      for(const [key,entry] of entries) {
        if(entry.counts[kind]>0 && !matched.has(key)) return null;
        if(kind==='checklists' && entry.counts[kind] !== (matched.get(key)||0)) return null;
      }
    }
    return new Map([...entries].map(([key,entry])=>[key,{
      counts:entry.counts,fingerprint:hash(entry.identities.sort().join('|')),
    }]));
  } catch { return null; }
}

function emptyOriginalReferences() {
  return {counts:emptyCounts(),fingerprint:hash('')};
}

// This does not grant permission to delete. A route must bind this snapshot
// to the authenticated admin and re-check it immediately before deletion.
function buildOriginalReviewPreview(report, keys) {
  if(!Array.isArray(keys)||!keys.length||keys.length>100||keys.some(key=>typeof key!=='string'))
    return {ok:false,items:[],message:'원본 PDF를 선택해 주세요.'};
  const groups=new Map((report.groups||[]).map(group=>[group.key,group]));
  const items=[];
  for(const key of new Set(keys)) {
    const group=groups.get(key);
    if(!group || group.kind!=='original' || !['review','unlinked'].includes(group.status) || !group.references)
      return {ok:false,items:[],message:'연결 정보를 확인하지 못했습니다. 목록을 다시 확인해 주세요.'};
    items.push({key,counts:group.references.counts});
  }
  const fingerprint=hash([...new Set(keys)].sort().map(key=>{
    const group=groups.get(key);
    return JSON.stringify([key,group.references.fingerprint,group.original.bytes,group.uploadedAt||'',group.originalName||'']);
  }).join('|'));
  return {ok:true,items,fingerprint};
}
function createOriginalReviewGate({now=Date.now}={}) {
  const tickets=new Map();
  const lifetime=10*60*1000;
  return {
    issue(userId,keys,report) {
      const preview=buildOriginalReviewPreview(report,keys);
      if(!preview.ok)return preview;
      const timestamp=now();
      for(const [token,ticket] of tickets)if(timestamp-ticket.at>=lifetime)tickets.delete(token);
      // Bound memory even if a client repeatedly opens previews.
      while(tickets.size>=100)tickets.delete(tickets.keys().next().value);
      const previewToken=randomBytes(24).toString('base64url');
      tickets.set(previewToken,{userId,at:timestamp,fingerprint:preview.fingerprint});
      return {ok:true,items:preview.items,previewToken};
    },
    consume(userId,keys,token,report) {
      const ticket=tickets.get(token);
      tickets.delete(token);
      if(!ticket || ticket.userId!==userId || now()-ticket.at>=lifetime || now()<ticket.at)return false;
      const current=buildOriginalReviewPreview(report,keys);
      return current.ok && current.fingerprint===ticket.fingerprint;
    },
  };
}
module.exports={collectOriginalReferences,emptyOriginalReferences,buildOriginalReviewPreview,createOriginalReviewGate};
