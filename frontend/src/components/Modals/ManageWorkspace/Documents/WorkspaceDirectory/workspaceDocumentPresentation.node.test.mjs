import test from "node:test";
import assert from "node:assert/strict";

let presentation = {};
try {
  presentation = await import("./workspaceDocumentPresentation.js");
} catch {}

function entry(id, overrides = {}) {
  return {
    folderName: "custom-documents",
    item: {
      id,
      name: `${id}.json`,
      title: "병원지침.pdf",
      document_id: "source-a",
      original_document_id: null,
      source_document_id: null,
      url: "file:///internal/병원지침.pdf",
      docSource: "pdf file uploaded by the user.",
      published: "unknown",
      page: Number(id.replace(/\D/g, "")) || 1,
      section: "",
      pinnedWorkspaces: [],
      watched: false,
      ...overrides,
    },
  };
}

test("ten page records with one stable PDF id become one visible document", () => {
  assert.equal(typeof presentation.buildOriginalDocumentRows, "function");
  const entries = Array.from({ length: 10 }, (_, index) =>
    entry(`item-${index + 1}`)
  );

  const rows = presentation.buildOriginalDocumentRows(entries);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "pdf");
  assert.equal(rows[0].title, "병원지침.pdf");
  assert.equal(rows[0].entries.length, 10);
});

test("equal filenames with different stable ids remain separate PDFs", () => {
  const rows = presentation.buildOriginalDocumentRows([
    entry("item-1", { document_id: "source-a" }),
    entry("item-2", { document_id: "source-b" }),
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.entries.length),
    [1, 1]
  );
});

test("original and source document ids take precedence over document_id", () => {
  const rows = presentation.buildOriginalDocumentRows([
    entry("item-1", {
      original_document_id: "original-a",
      source_document_id: "source-shared",
      document_id: "page-a",
    }),
    entry("item-2", {
      original_document_id: "original-a",
      source_document_id: "source-other",
      document_id: "page-b",
    }),
    entry("item-3", {
      original_document_id: null,
      source_document_id: "source-c",
      document_id: "page-c",
    }),
    entry("item-4", {
      original_document_id: null,
      source_document_id: "source-c",
      document_id: "page-d",
    }),
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.entries.length),
    [2, 2]
  );
});

test("PDFs without stable ids and non-PDF files keep individual rows", () => {
  const rows = presentation.buildOriginalDocumentRows([
    entry("item-1", { document_id: null }),
    entry("item-2", { title: "간호기록.docx", document_id: "docx-a" }),
  ]);

  assert.deepEqual(
    rows.map((row) => row.kind),
    ["item", "item"]
  );
});

test("selecting one PDF selects its exact existing child records", () => {
  const rows = presentation.buildOriginalDocumentRows([
    entry("item-1"),
    entry("item-2"),
  ]);

  const selected = presentation.toggleOriginalDocumentSelection(rows[0], {});
  assert.deepEqual(selected, { "item-1": true, "item-2": true });
  assert.equal(
    presentation.getOriginalDocumentSelectionState(rows[0], selected),
    "all"
  );

  const cleared = presentation.toggleOriginalDocumentSelection(
    rows[0],
    selected
  );
  assert.deepEqual(cleared, {});
  assert.equal(rows[0].entries[0].folderName, "custom-documents");
  assert.equal(rows[0].entries[0].item.name, "item-1.json");
});

test("a PDF row carries only its opaque original reference and link status", () => {
  const rows = presentation.buildOriginalDocumentRows([
    entry("item-1", {
      page: 1,
      pdfRef: "opaque-public-reference",
      originalPdfAvailable: false,
    }),
    entry("item-2", {
      page: 12,
      pdfRef: "opaque-public-reference",
      originalPdfAvailable: true,
    }),
  ]);

  assert.equal(rows[0].pdfRef, "opaque-public-reference");
  assert.equal(rows[0].originalPdfAvailable, true);
  assert.equal(rows[0].pageCount, 12);
  assert.equal(Object.hasOwn(rows[0], "documentId"), false);
});
