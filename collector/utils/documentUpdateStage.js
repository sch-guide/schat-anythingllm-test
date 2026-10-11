const path = require('node:path');
function updateDestination(documentsFolder, job) {
  if (typeof job !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(job))
    throw new Error('INVALID_DOCUMENT_UPDATE_JOB');
  return path.resolve(documentsFolder, '../document-updates', job, 'documents');
}
module.exports = { updateDestination };
