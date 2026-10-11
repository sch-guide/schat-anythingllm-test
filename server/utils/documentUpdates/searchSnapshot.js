const {guard}=require('./guard');
const {searchKey}=require('./scopes');
async function withSearchSnapshot(workspace,operation,{signal,response}={}) {
  const vector=require('../helpers').getVectorDbClass();
  if(vector.name!=='Chroma')return operation();
  signal ||= require('../chatAdmissionContext').currentAdmissionSignal();
  let controller,onClose;
  if(!signal && response?.once) {
    controller=new AbortController();signal=controller.signal;
    onClose=()=>controller.abort();response.once('close',onClose);
    if(response.destroyed||response.writableEnded)controller.abort();
  }
  try {return await guard.readWhenAvailable(operation,[searchKey(vector.normalize(workspace.slug))],{signal});}
  finally {if(onClose)response.removeListener('close',onClose);}
}
async function filterArchivedHistory(workspace,history,prisma) {
  if(!history?.length)return history;
  prisma ||= require('../prisma');
  const rows=await prisma.workspace_documents.findMany({where:{workspaceId:workspace.id}});
  const archived=rows.filter(require('./archive').isArchivedDocument);
  if(!archived.length)return history;
  const ids=new Set(archived.map(row=>JSON.parse(row.metadata||'{}').document_id).filter(Boolean));
  const docIds=new Set(archived.map(row=>row.docId).filter(Boolean));
  const paths=new Set(archived.map(row=>row.docpath).filter(Boolean));
  return history.map(chat=>{
    const response=JSON.parse(chat.response);
    return {...chat,response:JSON.stringify({...response,sources:(response.sources||[]).filter(source=>!ids.has(source.document_id)&&!docIds.has(source.docId)&&!paths.has(source.docpath))})};
  });
}
module.exports={withSearchSnapshot,filterArchivedHistory};
