const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Renal biopsy backfill reads Chroma but never mutates vectors", () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, "../../scripts/schatBackfillRenalBiopsyChecklist.js"),
    "utf8"
  );

  assert.match(script, /getCollection/);
  assert.match(script, /collection\.get/);
  assert.match(script, /extractRenalBiopsyChecklist/);
  assert.match(script, /saveAutoChecklist/);
  assert.doesNotMatch(script, /collection\.(?:upsert|add|update|delete)\s*\(/);
  assert.doesNotMatch(script, /Document\.addDocuments|update-embeddings/);
});
