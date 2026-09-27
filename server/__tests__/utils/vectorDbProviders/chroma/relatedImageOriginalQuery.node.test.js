const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Chroma,
} = require("../../../../utils/vectorDbProviders/chroma/index.js");

test("expanded body query cannot replace the original question for related image search", async () => {
  const imageKey = "c".repeat(64);
  const bodyQueryVector = [0.9, 0.1];
  const originalQuestionVector = [0.1, 0.9];
  const collection = {
    async query({ queryEmbeddings }) {
      if (queryEmbeddings === originalQuestionVector) {
        return {
          ids: [["image-nrs"]],
          documents: [["NRS tool selected on a zero-to-ten pain assessment screen"]],
          metadatas: [[
            {
              title: "hospital-guide.pdf",
              page: 100,
              content_type: "image_description",
              image_key: imageKey,
            },
          ]],
          distances: [[0.05]],
        };
      }
      return {
        ids: [["text-body"]],
        documents: [["Pain assessment clinical procedure and documentation"]],
        metadatas: [[{ title: "hospital-guide.pdf", page: 99 }]],
        distances: [[0.05]],
      };
    },
    async get() {
      return {
        ids: ["text-body", "image-nrs"],
        documents: [
          "Pain assessment clinical procedure and documentation",
          "NRS tool selected on a zero-to-ten pain assessment screen",
        ],
        metadatas: [
          { title: "hospital-guide.pdf", page: 99 },
          {
            title: "hospital-guide.pdf",
            page: 100,
            content_type: "image_description",
            image_key: imageKey,
          },
        ],
      };
    },
  };

  const result = await new Chroma().similarityResponse({
    client: { async getCollection() { return collection; } },
    namespace: "schat-test",
    queryVector: bodyQueryVector,
    queryText: "pain assessment clinical procedure scoring documentation",
    relatedImageQueryVector: originalQuestionVector,
    relatedImageQueryText: "NRS",
    similarityThreshold: 0.25,
    topN: 1,
  });

  assert.deepEqual(result.contextTexts, [
    "Pain assessment clinical procedure and documentation",
  ]);
  assert.deepEqual(
    result.relatedImageSources.map((source) => source.image_key),
    [imageKey]
  );
  assert.equal(
    result.relatedImageSources[0].text,
    "NRS tool selected on a zero-to-ten pain assessment screen"
  );
});

test("body-only variation search does not execute or return related image candidates", async () => {
  let queryCount = 0;
  const collection = {
    async query() {
      queryCount += 1;
      if (queryCount === 1) {
        return {
          ids: [["text-body"]],
          documents: [["Central venous catheter management procedure"]],
          metadatas: [[{ title: "hospital-guide.pdf", page: 12 }]],
          distances: [[0.05]],
        };
      }
      return {
        ids: [["image-result"]],
        documents: [["An unrelated image description"]],
        metadatas: [[
          {
            title: "hospital-guide.pdf",
            page: 100,
            content_type: "image_description",
            image_key: "d".repeat(64),
          },
        ]],
        distances: [[0.05]],
      };
    },
    async get() {
      return {
        ids: ["text-body"],
        documents: ["Central venous catheter management procedure"],
        metadatas: [{ title: "hospital-guide.pdf", page: 12 }],
      };
    },
  };

  const result = await new Chroma().similarityResponse({
    client: { async getCollection() { return collection; } },
    namespace: "schat-test",
    queryVector: [0.9, 0.1],
    queryText: "central venous catheter management",
    relatedImageQueryVector: [0.1, 0.9],
    relatedImageQueryText: "NRS",
    includeRelatedImages: false,
    similarityThreshold: 0.25,
    topN: 4,
  });

  assert.equal(queryCount, 1);
  assert.deepEqual(result.relatedImageSources, []);
});
