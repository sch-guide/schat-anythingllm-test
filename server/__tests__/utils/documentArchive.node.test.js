const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const archived = { id: 1, docpath: 'folder/old.json', workspaceId: 1, pinned: true, metadata: JSON.stringify({ schat_document_update_archived: true }) };
const active = { id: 2, docpath: 'folder/new.json', workspaceId: 1, metadata: '{}' };
function load(relative, dependencies = {}) {
  const filename = path.join(root, relative);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename), console, global: {},
    process: { env: { NODE_ENV: 'development' } },
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (name.includes('answerCacheRuntime')) return { beginMutation: () => () => {} };
      if (name.includes('documentUpdates/guard')) return { guard: { read: operation => operation() } };
      if (name.includes('documentUpdates/scopes')) return {workspaceKey:id=>`workspace:${id}`,pathKeys:async paths=>paths.map(value=>`document:${value}`)};
      if (name === '../utils/http') return { safeJsonParse: (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } } };
      if (name.includes('documentUpdates/archive')) return require(path.join(root, 'utils/documentUpdates/archive'));
      if (name === 'fs' || name === 'path') return require(name);
      return {};
    },
  }, { filename });
  return module.exports;
}
test('보관 문서는 고정 자료에서 제외하고 활성 문서는 유지한다', async () => {
  const { DocumentManager } = load('utils/DocumentManager/index.js', { '../../models/documents': { Document: { where: async () => [archived, active] } } });
  const result = await new DocumentManager({ workspace: { id: 1 } }).pinnedDocuments();
  assert.deepEqual(Array.from(result, x => x.id), [2]);
});
test('수정 전 보관 상태 조회 실패와 문서 없음은 수정 저장을 막는다', async () => {
  for (const missing of [false, true]) {
    const writes = [];
    const { Document } = load('models/documents.js', {
      '../utils/prisma': { workspace_documents: {
        findFirst: async () => { if (missing) return null; throw new Error('DB_UNAVAILABLE'); },
        update: async () => { writes.push('update'); return active; },
      } },
    });
    assert.equal((await Document.update(2, { pinned: true })).document, null);
    assert.deepEqual(writes, []);
  }
});
test('업데이트 잠금 중 일반 문서 수정은 대상 조회 후 저장 전에 거절한다', async () => {
  let reads = 0;
  const { Document } = load('models/documents.js', {
    '../utils/documentUpdates/guard': { guard: { read: async () => { throw new Error('DOCUMENT_UPDATE_LOCKED'); } } },
    '../utils/prisma': { workspace_documents: { findFirst: async () => { reads++; return active; }, update: async () => active } },
  });
  await assert.rejects(() => Document.update(2, { pinned: true }), /DOCUMENT_UPDATE_LOCKED/);
  assert.equal(reads, 1);
});
function registrationDependencies({ references = [], calls = [] } = {}) {
  return {
    uuid: { v4: () => 'synthetic-id' },
    '../utils/prisma': { workspace_documents: {
      findMany: async ({ where }) => references.filter(doc => doc.docpath === where.docpath),
      create: async ({ data }) => { calls.push(['save', data.docpath]); return data; },
    } },
    '../utils/helpers': { getVectorDbClass: () => ({ addDocumentToNamespace: async (_slug, _data, docpath) => { calls.push(['embed', docpath]); return { vectorized: true }; } }) },
    '../utils/files': { fileData: async docpath => { calls.push(['read', docpath]); return { title: 'synthetic', pageContent: 'synthetic' }; } },
    '../utils/EmbeddingWorkerManager': { emitProgress: () => {} },
    './telemetry': { Telemetry: { sendTelemetry: async () => {} } },
    './eventLogs': { EventLogs: { logEvent: async () => {} } },
    '../endpoints/utils': { getModelTag: () => 'test' },
  };
}
test('다른 경로 표기로 보관 파일 재등록 검사를 우회할 수 없다', async () => {
  for (const alias of ['./folder/old.json', 'folder\\old.json', 'folder//old.json']) {
    const calls = [];
    const { Document } = load('models/documents.js', registrationDependencies({ references: [archived], calls }));
    const result = await Document.addDocuments({ id: 1, slug: 'test' }, [alias]);
    assert.equal(result.failedToEmbed.length, 1);
    assert.deepEqual(calls, []);
  }
});
test('새 문서 읽기 검색 저장 DB 저장은 동일한 상대경로를 사용한다', async () => {
  const calls = [];
  const { Document } = load('models/documents.js', registrationDependencies({ calls }));
  await Document.addDocuments({ id: 1, slug: 'test' }, ['./folder\\new.json']);
  assert.deepEqual(calls, [['read', 'folder/new.json'], ['embed', 'folder/new.json'], ['save', 'folder/new.json']]);
});
test('상위 이동 절대경로 특수 경로는 문서 등록 전에 거절한다', async () => {
  for (const unsafe of ['../folder/old.json', 'folder/../old.json', '/folder/old.json', 'C:\\folder\\old.json', '\\\\server\\folder\\old.json', 'folder/file.json:stream', 'folder/\u0000old.json']) {
    const calls = [];
    const { Document } = load('models/documents.js', registrationDependencies({ calls }));
    await assert.rejects(() => Document.addDocuments({ id: 1, slug: 'test' }, [unsafe]), /INVALID_DOCUMENT_PATH/);
    assert.deepEqual(calls, []);
  }
});
test('보관 문서의 일반 수정과 삭제는 원본 연결을 보존한다', async () => {
  const mutations = [];
  const { Document } = load('models/documents.js', {
    '../utils/prisma': { workspace_documents: { findFirst: async () => archived, update: async () => { mutations.push('update'); return archived; }, delete: async () => mutations.push('delete') }, document_vectors: { deleteMany: async () => mutations.push('vectors') } },
    '../utils/helpers': { getVectorDbClass: () => ({ deleteDocumentFromNamespace: async () => mutations.push('namespace') }) },
    './eventLogs': { EventLogs: { logEvent: async () => {} } },
  });
  const result = await Document.update(1, { pinned: true });
  assert.equal(result.document, null);
  await Document.removeDocuments({ id: 1, slug: 'test' }, ['folder/old.json']);
  assert.deepEqual(mutations, []);
});
test('보관 문서 재등록은 검색 저장 호출 전에 거절한다', async () => {
  let embedded = 0;
  const { Document } = load('models/documents.js', {
    '../utils/prisma': { workspace_documents: { findMany: async () => [archived] } },
    '../utils/helpers': { getVectorDbClass: () => ({ addDocumentToNamespace: async () => { embedded++; return { vectorized: true }; } }) },
    '../utils/files': { fileData: async () => null },
    '../utils/EmbeddingWorkerManager': { emitProgress: () => {} },
    './telemetry': { Telemetry: { sendTelemetry: async () => {} } },
    './eventLogs': { EventLogs: { logEvent: async () => {} } },
    '../endpoints/utils': { getModelTag: () => 'test' },
  });
  const result = await Document.addDocuments({ id: 1, slug: 'test' }, ['folder/old.json']);
  assert.equal(result.failedToEmbed.length, 1);
  assert.equal(embedded, 0);
});
test('작업공간 화면은 보관 문서를 제외하고 원본 조회는 보관 연결을 유지한다', async () => {
  const prisma = { workspaces: { findFirst: async () => ({ id: 1, documents: [archived, active] }) }, workspace_documents: { findMany: async () => [archived, active] } };
  const { Document } = load('models/documents.js', { '../utils/prisma': prisma });
  const { Workspace } = load('models/workspace.js', { '../utils/prisma': prisma, './documents': { Document }, './systemSettings': { SystemSettings: {} } });
  Workspace._getContextWindow = () => null;
  Workspace._getCurrentContextTokenCount = async () => 0;
  assert.deepEqual(Array.from((await Workspace.get({ id: 1 })).documents, x => x.id), [2]);
  assert.deepEqual(Array.from((await Document.forWorkspace(1)), x => x.id), [1, 2]);
});
test('보관 연결이 있는 파일은 원본과 검색 캐시 삭제 전에 거절한다', async () => {
  const mutations = [];
  const { purgeDocument } = load('utils/files/purgeDocument.js', {
    '.': { normalizePath: x => x, purgeSourceDocument: async () => mutations.push('source'), purgeVectorCache: async () => mutations.push('cache') },
    '../../utils/prisma': { workspace_documents: { findMany: async () => [archived] } },
    '../../models/workspace': { Workspace: { where: async () => [] } },
  });
  await assert.rejects(() => purgeDocument('folder/old.json'), /ARCHIVED_DOCUMENT/);
  assert.deepEqual(mutations, []);
});
test('문서 선택기는 보관 전용 파일을 숨기고 공유 활성 파일은 표시한다', async () => {
  const required = { url: '', title: 'Synthetic', docAuthor: '', description: '', docSource: '', chunkSource: '', published: '', wordCount: 1, token_count_estimate: 1 };
  let references = [archived];
  const { getDocumentsByDocPaths } = load('utils/files/index.js', {
    fs: { existsSync: () => true, statSync: () => ({ size: 50 }), readFileSync: () => JSON.stringify(required) },
    uuid: { v5: () => 'cache' },
    '../../models/documents': { Document: { where: async () => references } },
    '../../models/documentSyncQueue': { DocumentSyncQueue: { enabled: async () => false } },
    '../originalDocuments': { publicOriginalPdfMetadata: () => ({}) },
  });
  assert.equal((await getDocumentsByDocPaths(['folder/old.json'])).length, 0);
  references = [archived, { ...active, docpath: archived.docpath }];
  assert.equal((await getDocumentsByDocPaths(['folder/old.json'])).length, 1);
});
test('보관 문서가 든 폴더는 파일 삭제 전에 거절한다', async () => {
  const mutations = [];
  const storage = path.resolve('synthetic-documents');
  const { purgeFolder } = load('utils/files/purgeDocument.js', {
    fs: { readdirSync: p => p === storage ? ['folder'] : ['old.json'], lstatSync: () => ({ isDirectory: () => true }), existsSync: () => true, rmSync: () => mutations.push('folder') },
    '.': { documentsPath: storage, normalizePath: x => x, isWithin: () => true, purgeVectorCache: async () => mutations.push('cache') },
    '../../utils/prisma': { workspace_documents: { findMany: async ({ where }) => { assert.deepEqual(Array.from(where.docpath.in), ['folder/old.json']); return [archived]; } } },
    '../../models/workspace': { Workspace: { where: async () => [] } },
  });
  await assert.rejects(() => purgeFolder('folder'), /ARCHIVED_DOCUMENT/);
  assert.deepEqual(mutations, []);
});
test('보관 여부 조회 실패 시 파일 삭제를 시작하지 않는다', async () => {
  const mutations = [];
  const { purgeDocument } = load('utils/files/purgeDocument.js', {
    '.': { normalizePath: x => x, purgeSourceDocument: async () => mutations.push('source'), purgeVectorCache: async () => mutations.push('cache') },
    '../../utils/prisma': { workspace_documents: { findMany: async () => { throw new Error('DB_UNAVAILABLE'); } } },
  });
  await assert.rejects(() => purgeDocument('folder/old.json'), /DB_UNAVAILABLE/);
  assert.deepEqual(mutations, []);
});
test('문서 요약 도우미는 보관 문서를 사용 가능한 근거로 내보내지 않는다', async () => {
  let registered;
  const { docSummarizer } = load('utils/agents/aibitat/plugins/summarize.js', {
    '../../../../models/documents': { Document: { where: async () => [archived, { ...active, docId: 'new-id' }] } },
    '../../../http': { safeJsonParse: JSON.parse },
  });
  docSummarizer.plugin().setup({ function: fn => { registered = fn; }, introspect: () => {}, handlerProps: { invocation: { workspace_id: 1 }, log: () => {} } });
  assert.deepEqual(JSON.parse(await registered.listDocuments()).map(x => x.document_id), ['new-id']);
});
test('보관 여부 조회 실패 시 일반 등록도 검색 저장을 시작하지 않는다', async () => {
  const { Document } = load('models/documents.js', {
    '../utils/prisma': { workspace_documents: { findMany: async () => { throw new Error('DB_UNAVAILABLE'); } } },
    '../utils/helpers': { getVectorDbClass: () => ({}) },
    '../utils/files': { fileData: async () => null },
    '../utils/EmbeddingWorkerManager': { emitProgress: () => {} },
    './telemetry': { Telemetry: { sendTelemetry: async () => {} } },
    './eventLogs': { EventLogs: { logEvent: async () => {} } },
    '../endpoints/utils': { getModelTag: () => 'test' },
  });
  await assert.rejects(() => Document.addDocuments({ id: 1, slug: 'test' }, ['folder/old.json']), /DB_UNAVAILABLE/);
});
