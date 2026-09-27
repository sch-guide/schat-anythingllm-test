const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  processDocumentChecklists,
} = require("../../../utils/documentChecklists/processDocuments");

const sourceText = fs.readFileSync(
  path.join(__dirname, "fixtures", "renal-biopsy-page-56.txt"),
  "utf8"
);

test("processed p.56 is saved without invoking retrieval or vector code", async () => {
  const calls = [];
  const result = await processDocumentChecklists(
    [{ location: "custom-documents/renal-page-56.json" }],
    {
      loadDocument: async () => ({
        document_id: "renal-document",
        title: "검사 및 시술(26.04.07).pdf",
        page: 56,
        pageContent: sourceText,
      }),
      repository: {
        saveAutoChecklist(checklist) {
          calls.push(checklist);
          return { created: true, checklist };
        },
      },
    }
  );

  assert.deepEqual(result, { created: 1, skipped: 0, errors: 0, review: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source.page, 56);
});

test("non-candidate pages are skipped", async () => {
  const result = await processDocumentChecklists([{ location: "other.json" }], {
    loadDocument: async () => ({
      document_id: "other-document",
      title: "other.pdf",
      page: 1,
      pageContent: "일반 설명",
    }),
    repository: {
      saveAutoChecklist() {
        throw new Error("must not save");
      },
    },
  });

  assert.deepEqual(result, { created: 0, skipped: 1, errors: 0, review: 0 });
});

test("checklist failures never reject the PDF upload caller", async () => {
  const result = await processDocumentChecklists(
    [{ location: "broken.json" }, { location: "missing.json" }],
    {
      loadDocument: async ({ location }) => {
        if (location === "broken.json") throw new Error("read failed");
        return null;
      },
      repository: { saveAutoChecklist() {} },
      logger: { warn() {} },
    }
  );

  assert.deepEqual(result, { created: 0, skipped: 1, errors: 1, review: 0 });
});
