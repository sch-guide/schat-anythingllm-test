const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const originals=require('../../utils/originalDocuments');
test('deleted notice requires an actual saved source, not a mention in answer text',()=>{
 const ref='a'.repeat(43);
 assert.equal(originals.responseReferencesPdf(JSON.stringify({sources:[{pdfRef:ref}]}),ref),true);
 assert.equal(originals.responseReferencesPdf(JSON.stringify({text:ref,sources:[{pdfRef:'other'}]}),ref),false);
 assert.equal(originals.responseReferencesPdf('{broken',ref),false);
});
test('same original writes and deletion cannot overlap; errors release the reservation',async()=>{
 const root=os.tmpdir();let resume;const wait=new Promise(resolve=>resume=resolve);
 const first=originals.withOriginalPdfLocks(['synthetic-key'],()=>wait,{storageRoot:root});
 await assert.rejects(originals.withOriginalPdfLocks(['synthetic-key'],()=>assert.fail(),{storageRoot:root}),/ORIGINAL_PDF_BUSY/);
 assert.equal(await originals.withOriginalPdfLocks(['different'],()=>42,{storageRoot:root}),42);
 resume();await first;
 await assert.rejects(originals.withOriginalPdfLocks(['synthetic-key'],()=>{throw Error('fake');},{storageRoot:root}),/fake/);
 assert.equal(await originals.withOriginalPdfLocks(['synthetic-key'],()=>42,{storageRoot:root}),42);
});
test('deleted receipt distinguishes removed PDFs from missing, failed removal and restored files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'schat-deleted-pdf-'));
 try {
  const id='synthetic-original',key=crypto.createHash('sha256').update(id).digest('hex');
  const pdf=path.join(root,key+'.pdf');fs.writeFileSync(pdf,'%PDF-synthetic');
  const ref=originals.pdfRefForDocumentId(id,{storageRoot:root});
  assert.equal(originals.wasOriginalPdfDeleted(ref,{storageRoot:root}),false);
  originals.markOriginalPdfDeletion(id,{storageRoot:root});
  assert.equal(originals.wasOriginalPdfDeleted(ref,{storageRoot:root}),false);
  fs.unlinkSync(pdf);
  assert.equal(originals.wasOriginalPdfDeleted(ref,{storageRoot:root}),true);
  assert.equal(originals.wasOriginalPdfDeleted('../invalid',{storageRoot:root}),false);
  fs.writeFileSync(pdf,'%PDF-restored');
  assert.equal(originals.wasOriginalPdfDeleted(ref,{storageRoot:root}),false);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
