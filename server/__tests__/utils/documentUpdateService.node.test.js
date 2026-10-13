const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBatch, verifyVectors } = require('../../utils/documentUpdates/service');
test('failed PDF preparation leaves live document files unchanged', async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'schat-update-service-'));
  try {
    await fs.mkdir(path.join(root,'documents','custom-documents'), {recursive:true});
    await fs.writeFile(path.join(root,'documents','custom-documents','old.json'), JSON.stringify({title:'규정.pdf', document_id:'old'}));
    const { executeDocumentUpdate } = require('../../utils/documentUpdates/service');
    await assert.rejects(executeDocumentUpdate({workspace:{id:1,slug:'test'}, files:[{originalname:'규정.pdf',filename:'test.pdf',path:'fake'}], manifest:{names:['규정.pdf'],conflicts:[{name:'규정.pdf',documents:[{docpath:'custom-documents/old.json',documentId:'old'}]}]}}, {
      root, guard:new (require('../../utils/documentUpdates/guard').UpdateGuard)(path.join(root,'guard')), provider:'chroma', collector:{processDocument:async()=>{throw new Error('parser failed');}},
      preserve:async()=>{}, prisma:{document_vectors:{deleteMany:async()=>{}},workspace_documents:{findMany:async()=>[{docpath:'custom-documents/old.json'}]}}, vector:{normalize:x=>x,connect:async()=>({client:{deleteCollection:async()=>{}}})},
    }), /parser failed/);
    assert.equal(JSON.parse(await fs.readFile(path.join(root,'documents','custom-documents','old.json'),'utf8')).document_id,'old');
    assert.deepEqual(await fs.readdir(path.join(root,'documents','custom-documents')),['old.json']);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
test('batch identity must exactly match confirmed names and PDF support fails closed', () => {
  const files = [{ originalname: '규정.pdf', path: 'temporary' }];
  assert.equal(validateBatch(files, { names: ['규정.pdf'], conflicts: [], folderName: '분류' }).folderName, '분류');
  assert.throws(() => validateBatch(files, { names: ['다른.pdf'], conflicts: [] }), /BATCH_CHANGED/);
  assert.throws(() => validateBatch([{ originalname: '규정.docx' }], { names: ['규정.docx'], conflicts: [] }), /PDF_ONLY/);
  assert.throws(() => validateBatch(files, { names: ['규정.pdf'], conflicts: [], folderName: '..' }), /INVALID_FOLDER/);
});
test('missing or malformed embeddings cannot retire original search data', () => {
  const good = { ids:['a'], embeddings:[[0,1]], documents:['새 규정'], metadatas:[{document_id:'new'}] };
  assert.doesNotThrow(() => verifyVectors(good, ['a']));
  assert.throws(() => verifyVectors({...good, embeddings:[]}, ['a']), /VECTOR_VERIFICATION_FAILED/);
  assert.throws(() => verifyVectors(good, ['a','b']), /VECTOR_VERIFICATION_FAILED/);
  assert.throws(() => verifyVectors({...good, embeddings:[[NaN]]}, ['a']), /VECTOR_VERIFICATION_FAILED/);
});
