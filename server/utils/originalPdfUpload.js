const { v4: uuidv4 } = require("uuid");
const { persistOriginalPdf } = require("./originalDocuments");

function isPdfUpload(file = {}) {
  return /\.pdf$/i.test(String(file.originalname || ""));
}

async function prepareOriginalPdfUpload({
  file,
  metadata = {},
  createDocumentId = uuidv4,
  persist = persistOriginalPdf,
}) {
  const preparedMetadata = { ...metadata };
  if (!isPdfUpload(file)) {
    return { metadata: preparedMetadata, preserved: null };
  }

  const documentId = createDocumentId();
  preparedMetadata.document_id = documentId;
  const preserved = await persist({
    sourcePath: file.path,
    documentId,
    originalName: file.originalname,
  });
  return { metadata: preparedMetadata, preserved };
}

module.exports = { isPdfUpload, prepareOriginalPdfUpload };
