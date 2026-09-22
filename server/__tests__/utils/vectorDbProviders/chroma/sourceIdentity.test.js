const { attachVectorIdentity } = require("../../../../utils/vectorDbProviders/chroma/sourceIdentity");

test("preserves the Chroma vector id as chunk id and maps the stored document id", () => {
  const result = attachVectorIdentity(
    [{ id: "vector-1", title: "지침.pdf" }],
    [{ vectorId: "vector-1", docId: "document-1" }]
  );
  expect(result).toEqual([
    {
      id: "vector-1",
      chunk_id: "vector-1",
      documentId: "document-1",
      document_id: "document-1",
      title: "지침.pdf",
    },
  ]);
});

test("does not invent a document id when the mapping is missing", () => {
  const result = attachVectorIdentity([{ id: "vector-1" }], []);
  expect(result[0].documentId).toBe("");
  expect(result[0].document_id).toBe("");
});
