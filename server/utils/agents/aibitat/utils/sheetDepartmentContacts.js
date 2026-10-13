const compact=value=>String(value||'').replace(/\s/gu,'');
function departmentContactTarget(question){
 const text=String(question||'').split('<hospital_document_context>')[0].replace(/^@agent\s*/u,'').trim();
 const match=/^(.+?)\s*전담\s*(?:간호사)?\s*(?:(?:단축(?:번호)?|전화\s*번호|연락처|번호))?\s*(?:(?:좀\s*)?알려\s*(?:주세요|줘요|줘))?\s*[?？.!]?$/u.exec(text);
 if(!match||/말고|제외|아닌|비교|및|와 |과 /u.test(match[1]))return null;
 const target=compact(match[1]);
 return /^[가-힣A-Za-z0-9·]{2,30}$/u.test(target)?target:null;
}
function sheetDepartmentContacts(data,question){
 const target=departmentContactTarget(question);if(!target)return null;
 const header=data.rows.find(row=>row.cells.some(c=>compact(c)==='과명')&&row.cells.some(c=>compact(c)==='전담간호사')&&row.cells.some(c=>compact(c)==='단축번호'));
 if(!header)return null;
 const labels=header.cells.map(compact),department=labels.indexOf('과명'),person=labels.indexOf('전담간호사'),number=labels.indexOf('단축번호');
 const value=(row,column)=>{
  const merges=(data.merges||[]).filter(m=>m.s.c===column&&m.e.c===column&&m.s.r<=row.row-1&&m.e.r>=row.row-1);
  if(merges.length>1)return '';
  return row.cells[column]||merges[0]?.value||'';
 };
 const departments=[...new Set(data.rows.filter(r=>r.row>header.row).map(r=>value(r,department)).filter(Boolean))];
 const alternatives=require('../../../chats/directoryContactAliases').departmentAlternatives(target);
 const choices=departments.filter(d=>alternatives.some(term=>compact(d).startsWith(compact(term))));
 if(choices.length!==1)return null;
 const contacts=[],quotes=[];
 for(const row of data.rows){
  if(row.row<=header.row||value(row,department)!==choices[0])continue;
  // Never inherit a person's name or number from a neighbouring row.
  const name=String(row.cells[person]||'').trim(),phone=String(row.cells[number]||'').trim();
  if(!name||!/^\d{3,6}$/u.test(phone))continue;
  contacts.push({name,number:phone,row:row.row});
  quotes.push(`행 ${row.row}: `+header.cells.map((label,c)=>`${label||`열 ${c+1}`}: ${row.cells[c]||'[빈 칸]'}`).join(' | '));
 }
 if(!contacts.length||contacts.length>40)return null;
 return {department:choices[0],contacts,quotes,question:String(question).trim()};
}
async function enrichSheetDepartmentSource(source,question){
 if(!departmentContactTarget(question))return source;
 const id=source.document_id||source.documentId;
 const name=source.document_name||source.documentName||source.title||'';
 if(!id||! /\.(xlsx|xls)$/iu.test(name))return source;
 try{
  const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
  const {spreadsheetRoot,previewSpreadsheet}=require('../../../originalSpreadsheet');
  const root=spreadsheetRoot(),key=createHash('sha256').update(String(id)).digest('hex');
  const saved=JSON.parse(fs.readFileSync(path.join(root,key+'.json'),'utf8'));
  if(!['.xlsx','.xls'].includes(saved.extension))return source;
  const sheet=String(source.section||'').replace(/^시트:\s*/u,'');
  if(!sheet)return source;
  const file=path.join(root,key+saved.extension);
  const data=previewSpreadsheet(file,{sheet,start:0,limit:200});
  if(data.totalRows>2000)return source;
  for(let start=200;start<data.totalRows;start+=200){
   const part=previewSpreadsheet(file,{sheet,start,limit:200});data.rows.push(...part.rows);
   for(const m of part.merges)if(!data.merges.some(old=>JSON.stringify(old)===JSON.stringify(m)))data.merges.push(m);
  }
  const result=sheetDepartmentContacts(data,question);
  if(!result)return source;
  // Runtime evidence only: original row values and row numbers are preserved.
  const text=result.quotes.join('\n');
  return {...source,text,excerpt:text,sheetDepartmentContacts:result};
 }catch{return source;}
}
function sheetDepartmentAnswer(sources,question){
 question=String(question||'').split('<hospital_document_context>')[0].trim();
 const sheets=sources.filter(s=>s.sheetDepartmentContacts?.question===question);
 if(!sheets.length)return null;
 const signatures=new Set(sheets.map(s=>JSON.stringify([s.sheetDepartmentContacts.department,s.sheetDepartmentContacts.contacts])));
 if(signatures.size!==1)return null;
 const source=sheets[0],group=source.sheetDepartmentContacts;
 if(!group.quotes.every(q=>compact(source.text||source.excerpt).includes(compact(q))))return null;
 return {source,quotes:group.quotes,text:`${group.department} 전담간호사 단축번호입니다.\n`+group.contacts.map(c=>`- ${c.name}: ${c.number}`).join('\n')};
}
async function resolveWorkspaceDepartmentContact(workspace,question,options={}){
 if(!workspace?.id||!departmentContactTarget(question))return null;
 const prisma=options.prisma||require('../../../prisma');
 const snapshot=options.snapshot||require('../../../documentUpdates/searchSnapshot').withSearchSnapshot;
 const enrich=options.enrich||enrichSheetDepartmentSource;
 return snapshot(workspace,async()=>{
  const rows=await prisma.workspace_documents.findMany({where:{workspaceId:workspace.id},select:{metadata:true}});
  const seen=new Set(),sources=[];
  for(const row of rows){
   let m;try{m=typeof row.metadata==='string'?JSON.parse(row.metadata):row.metadata;}catch{continue;}
   if(!m||m.schat_document_update_archived||!m.document_id||! /\.(xlsx|xls)$/iu.test(m.title||m.document_name||''))continue;
   const key=JSON.stringify([m.document_id,m.section]);if(seen.has(key))continue;seen.add(key);
   const source=await enrich(m,question);
   if(source.sheetDepartmentContacts)sources.push(require('./ragSources').buildPublicRagSource(source));
  }
  const answer=sheetDepartmentAnswer(sources,question);
  if(answer)answer.source.evidenceQuotes=answer.quotes;
  return answer;
 });
}
module.exports={sheetDepartmentContacts,enrichSheetDepartmentSource,sheetDepartmentAnswer,departmentContactTarget,resolveWorkspaceDepartmentContact};
