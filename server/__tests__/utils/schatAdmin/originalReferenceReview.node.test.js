const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const review = require('../../../utils/schatAdmin/originalReferenceReview');
const {classifyStorage,publicReport}=require('../../../utils/schatAdmin/storageCleanup');
const key = crypto.createHash('sha256').update('synthetic-document').digest('hex');
const source = {document_id:'synthetic-document'};
function input() {
  return {chats:[{id:1,response:JSON.stringify({sources:[source,source],textResponse:'합성 시험 내용'})}],
    quizSets:[{id:7,document_id:'synthetic-document'}],quizQuestions:[],quizRuns:[],
    checklists:new Map([['synthetic-document',2]]), workspaceDocumentIds:new Set(),
    chromaDocumentIds:new Set(),imageFolders:[],
    referenceIdentities:{checklists:[{document_id:'synthetic-document',id:'check-1'},{document_id:'synthetic-document',id:'check-2'}],workspaces:[],search:[],images:[]}};
}
test('reference review counts a conversation once and never exposes content',()=>{
  const result=review.collectOriginalReferences(input());
  assert.equal(result.get(key).counts.chats,1);
  assert.equal(result.get(key).counts.quizSets,1);
  assert.equal(result.get(key).counts.checklists,2);
  assert.doesNotMatch(JSON.stringify([...result]),/textResponse|synthetic-document|합성 시험 내용/);
});
test('changing a checklist, workspace, search record or image identity invalidates review even at equal counts',()=>{
  for(const kind of ['checklists','workspaces','search','images']) {
    const first=input();
    first.referenceIdentities[kind]=[{document_id:'synthetic-document',id:'before'}];
    if(kind==='checklists')first.checklists.set('synthetic-document',1);
    if(kind==='workspaces')first.workspaceDocumentIds.add('synthetic-document');
    if(kind==='search')first.chromaDocumentIds.add('synthetic-document');
    if(kind==='images')first.imageFolders.push({name:'synthetic-document'});
    const before=review.collectOriginalReferences(first).get(key).fingerprint;
    first.referenceIdentities[kind][0].id='after';
    assert.notEqual(before,review.collectOriginalReferences(first).get(key).fingerprint,kind);
  }
});
test('missing stable identities does not authorize a reference review',()=>{
  const data=input();delete data.referenceIdentities;
  assert.equal(review.collectOriginalReferences(data),null);
});
test('same reference count but a different conversation changes confirmation fingerprint',()=>{
  const first=review.collectOriginalReferences(input()).get(key);
  const next=input();next.chats[0].id=2;
  assert.notEqual(first.fingerprint,review.collectOriginalReferences(next).get(key).fingerprint);
});
test('unreadable conversation references fail closed instead of counting zero',()=>{
  const next=input();next.chats[0].response='{broken';
  assert.equal(review.collectOriginalReferences(next),null);
});
test('preview allows reviewed historical references but refuses incomplete scans and active originals',()=>{
  const references=review.collectOriginalReferences(input());
  const group={key:'opaque',kind:'original',status:'review',originalKey:key,original:{bytes:100},references:references.get(key)};
  const result=review.buildOriginalReviewPreview({groups:[group]},['opaque']);
  assert.equal(result.ok,true);assert.equal(result.items[0].counts.chats,1);
  assert.doesNotMatch(JSON.stringify(result),new RegExp(key));
  assert.equal(review.buildOriginalReviewPreview({groups:[{...group,references:null}]},['opaque']).ok,false);
  assert.equal(review.buildOriginalReviewPreview({groups:[{...group,kind:'upload',status:'in_use'}]},['opaque']).ok,false);
});
test('preview refuses empty, unknown, malformed and partly unsafe selections',()=>{
  for(const keys of [[],['unknown'],null,'opaque'])
    assert.equal(review.buildOriginalReviewPreview({groups:[]},keys).ok,false);
});
test('storage report carries reviewed counts but hides the internal reference fingerprint',()=>{
  const report=classifyStorage({originals:[{storageKey:key,bytes:100}],knownDocumentIds:new Set(['synthetic-document']),originalReferences:review.collectOriginalReferences(input())});
  const preview=review.buildOriginalReviewPreview(report,[report.groups[0].key]);
  assert.equal(preview.ok,true);
  assert.equal(publicReport(report).groups[0].references.counts.chats,1);
  assert.doesNotMatch(JSON.stringify(publicReport(report)),/fingerprint/);
});
test('review permits only the same administrator and selection once within its lifetime',()=>{
  assert.equal(typeof review.createOriginalReviewGate,'function');
  let now=0;const gate=review.createOriginalReviewGate({now:()=>now});
  const report={groups:[{key:'first',kind:'original',status:'review',original:{bytes:10},references:review.collectOriginalReferences(input()).get(key)}]};
  const issued=gate.issue(7,['first'],report);
  assert.equal(issued.ok,true);assert.doesNotMatch(JSON.stringify(issued),/fingerprint/);
  assert.equal(gate.consume(8,['first'],issued.previewToken,report),false);
  const valid=gate.issue(7,['first'],report);
  assert.equal(gate.consume(7,['first'],valid.previewToken,report),true);
  assert.equal(gate.consume(7,['first'],valid.previewToken,report),false);
  const expired=gate.issue(7,['first'],report);now=600001;
  assert.equal(gate.consume(7,['first'],expired.previewToken,report),false);
  const changed=gate.issue(7,['first'],report);report.groups[0].original.bytes=11;
  assert.equal(gate.consume(7,['first'],changed.previewToken,report),false);
  const selection=gate.issue(7,['first'],report);
  assert.equal(gate.consume(7,['other'],selection.previewToken,report),false);
  const renamed=gate.issue(7,['first'],report);report.groups[0].originalName='다른파일.pdf';
  assert.equal(gate.consume(7,['first'],renamed.previewToken,report),false);
});
