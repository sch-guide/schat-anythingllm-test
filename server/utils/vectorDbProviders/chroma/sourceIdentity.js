function attachVectorIdentity(sourceDocuments = [], vectorMappings = []) {
  const documentByVector = new Map(
    vectorMappings.map((mapping) => [mapping.vectorId, mapping.docId])
  );
  return sourceDocuments.map((source) => {
    const id = source.id || source.chunk_id || "";
    const documentId =
      source.documentId ||
      source.document_id ||
      documentByVector.get(id) ||
      "";
    return {
      ...source,
      id,
      chunk_id: id,
      documentId,
      document_id: documentId,
    };
  });
}

module.exports = { attachVectorIdentity };
