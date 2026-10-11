// Conservative, workspace-isolated in-memory cache. No persisted answer data.
function stableContext(value) {
  if (Array.isArray(value)) return value.map(stableContext);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableContext(value[key])]));
  return value;
}
function normalizeQuestion(question) {
  if (typeof question !== 'string' || question.length > 4000) return null;
  const text = question.normalize('NFC').trim().replace(/[?!？！]+$/u, '').trim();
  if (!text) return null;
  // Preserve numeric boundaries and unit case before removing whitespace.
  // In particular 1 0 != 10, and mM != mm. Internal punctuation is meaningful.
  const quantities = (text.match(/\d+(?:[.,]\d+)*(?:\s*[a-zA-Zµμ]+)?/gu) || [])
    .map(value => value.replace(/\s+/gu, ''));
  // Standalone units need the same protection (mM vs mm, M vs m).
  // Preserve unknown mixed-case symbols too: missing a hit is safer than merging.
  const unitNames = new Set(['g','mg','kg','mcg','ug','µg','μg','ng','l','ml','dl',
    'ul','µl','μl','m','mm','cm','km','nm','mol','mmol','umol','µmol','μmol','iu','u','eq','meq','osm','mosm']);
  const symbols = (text.match(/[a-zA-Zµμ]+/gu) || []).filter(word =>
    unitNames.has(word.toLowerCase()) || (/[a-z]/.test(word) && /[A-Z]/.test(word)));
  return JSON.stringify([text.replace(/\s+/gu, '').toLowerCase(), quantities, symbols]);
}

function createAnswerCache({ now = Date.now } = {}) {
  const entries = new Map(), generations = new Map(), mutations = new Map();
  let nextId = 0, hits = 0, globalMutations = 0;
  const workspace = id => Number.isSafeInteger(id) && id > 0;
  function generation(id) {
    if (!workspace(id)) throw new TypeError('Valid workspace ID required');
    if (!generations.has(id)) generations.set(id, 0);
    return generations.get(id);
  }
  function key(id, question, context = null) {
    const normalized = normalizeQuestion(question);
    return workspace(id) && normalized ? JSON.stringify([id, normalized, stableContext(context)]) : null;
  }
  const blocked = id => globalMutations > 0 || (mutations.get(id) || 0) > 0;
  function put({workspaceId, question, value, generation: expected, context = null}) {
    const cacheKey = key(workspaceId, question, context);
    if (!cacheKey || blocked(workspaceId) || expected !== generation(workspaceId) || !value || typeof value.answer !== 'string' || !value.answer.trim()) return false;
    const copy = structuredClone(value);
    entries.delete(cacheKey);
    entries.set(cacheKey, {id: String(++nextId), workspaceId, question,
      value: copy, createdAt: now(), uses: 0});
    while (entries.size > 100) entries.delete(entries.keys().next().value);
    return true;
  }
  function get(id, question, context = null) {
    if (blocked(id)) return null;
    const cacheKey = key(id, question, context), entry = entries.get(cacheKey);
    if (!entry) return null;
    entries.delete(cacheKey); entries.set(cacheKey, entry);
    entry.uses++; hits++;
    return structuredClone(entry.value);
  }
  function invalidate(id) {
    generations.set(id, generation(id) + 1);
    for (const [k, entry] of entries) if (entry.workspaceId === id) entries.delete(k);
  }
  function list(id) {
    return [...entries.values()].filter(entry => id == null || entry.workspaceId === id)
      .map(({value, ...metadata}) => ({...metadata}));
  }
  function remove(id) {
    for (const [k, entry] of entries) if (entry.id === id) return entries.delete(k);
    return false;
  }
  function clear() {
    entries.clear();
    for (const [id, version] of generations) generations.set(id, version + 1);
  }
  function beginMutation(ids = null) {
    const scoped = ids == null ? null : [...new Set(ids)];
    if (scoped) {
      scoped.forEach(id => generation(id));
      for (const id of scoped) {
        mutations.set(id, (mutations.get(id) || 0) + 1);
        invalidate(id);
      }
    } else { globalMutations++; clear(); }
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (scoped) for (const id of scoped) {
        invalidate(id);
        const count = mutations.get(id) - 1;
        if (count) mutations.set(id, count); else mutations.delete(id);
      }
      else { clear(); globalMutations--; }
    };
  }
  return {generation, put, get, invalidate, list, remove, clear, beginMutation,
    stats: () => ({entries: entries.size, hits})};
}
module.exports = {normalizeQuestion, createAnswerCache};
