const fs = require('node:fs/promises');
const path = require('node:path');
function documentKey(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 1024 || /[\u0000-\u001f]/.test(name))
    throw new Error('DOCUMENT_UPDATE_INVALID_SCOPE');
  const parts = name.replace(/\\/g, '/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..'))
    throw new Error('DOCUMENT_UPDATE_INVALID_SCOPE');
  return `document:${parts.at(-1).normalize('NFC').toLowerCase()}`;
}
function workspaceKey(id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('DOCUMENT_UPDATE_INVALID_SCOPE');
  return `workspace:${id}`;
}
function searchKey(namespace) {
  if (typeof namespace !== 'string' || !namespace) throw new Error('DOCUMENT_UPDATE_INVALID_SCOPE');
  return `search:${namespace}`;
}
async function pathKeys(paths, root=process.env.STORAGE_DIR || path.resolve(__dirname,'../../storage')) {
  const catalog=path.resolve(root,'documents');
  const keys=[];
  for(const filename of paths) {
    keys.push(documentKey(filename));
    const target=path.resolve(catalog,filename);
    if(!target.startsWith(catalog+path.sep))throw new Error('DOCUMENT_UPDATE_INVALID_SCOPE');
    try {
      const data=JSON.parse(await fs.readFile(target,'utf8'));
      if(data.title)keys.push(documentKey(data.title));
    } catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  return [...new Set(keys)];
}
function createScopedOperations(guard) {
  return {
    document(workspaceId, names, operation) {
      if (!Array.isArray(names) || !names.length) throw new Error('DOCUMENT_UPDATE_INVALID_SCOPE');
      return guard.read(operation, [workspaceKey(workspaceId), ...names.map(documentKey)]);
    },
    async reset(workspaceId, job, operation) {
      const keys = [workspaceKey(workspaceId)];
      const release = await guard.acquire(job, keys);
      try { return await guard.owned(operation, keys); }
      finally { await release(); }
    },
  };
}
const operations = createScopedOperations(require('./guard').guard);
module.exports = { documentKey, workspaceKey, searchKey, pathKeys, createScopedOperations, operations };
