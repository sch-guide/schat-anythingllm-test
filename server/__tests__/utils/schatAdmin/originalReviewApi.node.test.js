const test=require('node:test');
const assert=require('node:assert/strict');
const {createOriginalReviewApi}=require('../../../utils/schatAdmin/originalReviewApi');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {classifyStorage,executeOriginalPdfCleanup,originalStorageKey}=require('../../../utils/schatAdmin/storageCleanup');
const report={groups:[{key:'test',kind:'original',status:'review',original:{bytes:1},references:{counts:{chats:2},fingerprint:'test'}}]};
function response(id=1){return {locals:{user:{id}},code:200,status(value){this.code=value;return this;},json(value){this.body=value;return this;}};}
test('preview returns counts and an opaque ticket; read failure returns a safe error',async()=>{
  let fail=false;
  const api=createOriginalReviewApi({loadReport:async()=>{if(fail)throw Error('private details');return report;},body:req=>req.body});
  const res=response();await api.preview({body:{keys:['test']}},res);
  assert.equal(res.body.ok,true);assert.equal(res.body.items[0].counts.chats,2);
  assert.equal(typeof res.body.previewToken,'string');assert.doesNotMatch(JSON.stringify(res.body),/fingerprint/);
  assert.equal(api.verify(res,{keys:['test'],previewToken:res.body.previewToken},report),true);
  assert.equal(api.verify(res,{keys:['test'],previewToken:res.body.previewToken},report),false);
  fail=true;const bad=response();await api.preview({body:{keys:['test']}},bad);
  assert.equal(bad.code,503);assert.doesNotMatch(JSON.stringify(bad.body),/private details/);
});
test('real cleanup requires a fresh same-admin ticket before removing a synthetic unused PDF',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'schat-review-api-'));
  const directory=path.join(root,'original-documents');fs.mkdirSync(directory);
  const storageKey=originalStorageKey('synthetic-unused');
  const filename=path.join(directory,storageKey+'.pdf');fs.writeFileSync(filename,'%PDF- synthetic');
  const loadInputs=async()=>({knownDocumentIds:new Set(),originalReferences:new Map(),originals:fs.existsSync(filename)?[{storageKey,bytes:15}]:[]});
  const loadReport=async()=>classifyStorage(await loadInputs());
  const api=createOriginalReviewApi({loadReport,body:req=>req.body});
  const keys=[(await loadReport()).groups[0].key];
  const preview=response();await api.preview({body:{keys}},preview);
  const noTicket=await executeOriginalPdfCleanup(keys,{root,loadInputs,verifyReview:current=>api.verify(preview,{keys},current)});
  assert.equal(noTicket.deleted,0);assert.equal(fs.existsSync(filename),true);
  const accepted=await executeOriginalPdfCleanup(keys,{root,loadInputs,verifyReview:current=>api.verify(preview,{keys,previewToken:preview.body.previewToken},current)});
  assert.equal(accepted.deleted,1);assert.equal(fs.existsSync(filename),false);
});
test('preview validates selection before scanning and does not cross administrators',async()=>{
  let loads=0;
  const api=createOriginalReviewApi({loadReport:async()=>{loads++;return report;},body:req=>req.body});
  for(const keys of [null,[],['test',7]]) {
    const res=response();await api.preview({body:{keys}},res);assert.equal(res.code,400);
  }
  assert.equal(loads,0);
  const res=response();await api.preview({body:{keys:['test']}},res);
  assert.equal(api.verify(response(2),{keys:['test'],previewToken:res.body.previewToken},report),false);
});
