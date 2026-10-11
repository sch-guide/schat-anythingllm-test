const { documentKey } = require('../documentUpdates/scopes');

// Hold the selected names through the final scan and removal. The replacement
// service takes exclusive leases on these same names; unrelated files proceed.
async function withOriginalCleanupLock(keys, operation, { loadReport, guard }) {
  if (!Array.isArray(keys) || !keys.length || keys.length > 100 || keys.some(key => typeof key !== 'string'))
    throw new Error('ORIGINAL_SCOPE_UNKNOWN');
  const report = await loadReport();
  const groups = new Map((report.groups || []).map(group => [group.key, group]));
  const scopes = [...new Set(keys.map(key => {
    const group = groups.get(key);
    if (group?.kind !== 'original' || typeof group.originalName !== 'string' || !group.originalName.trim())
      throw new Error('ORIGINAL_SCOPE_UNKNOWN');
    return documentKey(group.originalName);
  }))];
  return guard.read(operation, scopes);
}

module.exports = { withOriginalCleanupLock };
