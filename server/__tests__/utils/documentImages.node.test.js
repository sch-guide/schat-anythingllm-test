const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  resolveWorkspaceImage,
} = require("../../utils/documentImages");

test("workspace image resolver returns only a verified path inside document image storage", () => {
  const key = "a".repeat(64);
  const storageRoot = path.resolve("/tmp/document-images");
  const resolved = resolveWorkspaceImage({
    imageKey: key,
    storageRoot,
    documents: [
      {
        metadata: JSON.stringify({
          pdf_images: [
            {
              image_key: key,
              storage_relative_path: `doc/page-1-image-1-${key.slice(0, 12)}.png`,
            },
          ],
        }),
      },
    ],
  });

  assert.equal(
    resolved,
    path.resolve(storageRoot, `doc/page-1-image-1-${key.slice(0, 12)}.png`)
  );
});

test("workspace image resolver rejects unknown keys and traversal metadata", () => {
  const key = "b".repeat(64);
  const documents = [
    {
      metadata: JSON.stringify({
        pdf_images: [
          {
            image_key: key,
            storage_relative_path: "../../secret.png",
          },
        ],
      }),
    },
  ];

  assert.equal(
    resolveWorkspaceImage({ imageKey: key, storageRoot: "/tmp/images", documents }),
    null
  );
  assert.equal(
    resolveWorkspaceImage({
      imageKey: "not-an-image-key",
      storageRoot: "/tmp/images",
      documents,
    }),
    null
  );
});
