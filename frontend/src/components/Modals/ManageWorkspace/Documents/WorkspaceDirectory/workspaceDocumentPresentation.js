function stableOriginalDocumentKey(item = {}) {
  const identifiers = [
    ["original", item.original_document_id],
    ["source", item.source_document_id],
    ["document", item.document_id],
  ];
  const match = identifiers.find(
    ([, value]) => typeof value === "string" && value.trim()
  );
  return match ? `${match[0]}:${match[1].trim()}` : null;
}

function isPdf(item = {}) {
  return typeof item.title === "string" && /\.pdf$/i.test(item.title.trim());
}

export function buildOriginalDocumentRows(entries = []) {
  const rows = [];
  const pdfRows = new Map();

  for (const entry of entries) {
    const originalKey = isPdf(entry?.item)
      ? stableOriginalDocumentKey(entry.item)
      : null;
    if (!originalKey) {
      rows.push({ kind: "item", entry });
      continue;
    }

    if (!pdfRows.has(originalKey)) {
      const row = {
        kind: "pdf",
        key: originalKey,
        title: entry.item.title.trim(),
        entries: [],
        pdfRef:
          typeof entry.item.pdfRef === "string" ? entry.item.pdfRef : null,
        originalPdfAvailable: entry.item.originalPdfAvailable === true,
        pageCount: 0,
      };
      pdfRows.set(originalKey, row);
      rows.push(row);
    }
    const row = pdfRows.get(originalKey);
    row.entries.push(entry);
    if (!row.pdfRef && typeof entry.item.pdfRef === "string")
      row.pdfRef = entry.item.pdfRef;
    row.originalPdfAvailable =
      row.originalPdfAvailable || entry.item.originalPdfAvailable === true;
    const page = Number(entry.item.page);
    if (Number.isInteger(page) && page > row.pageCount) row.pageCount = page;
  }

  return rows;
}

// "등록 문서 N개 · 총 M쪽": one original PDF counts once, its linked page
// records count as pages; any other workspace file is one document, one page.
export function workspaceDocumentSummary(rows = []) {
  return rows.reduce(
    (acc, row) => ({
      documents: acc.documents + 1,
      pages: acc.pages + (row.kind === "pdf" ? row.entries.length : 1),
    }),
    { documents: 0, pages: 0 }
  );
}

export function getOriginalDocumentSelectionState(row, selectedItems = {}) {
  const ids = row?.entries?.map(({ item }) => item.id) || [];
  const selectedCount = ids.filter((id) => selectedItems[id]).length;
  if (selectedCount === 0) return "none";
  return selectedCount === ids.length ? "all" : "some";
}

export function toggleOriginalDocumentSelection(row, selectedItems = {}) {
  const next = { ...selectedItems };
  const ids = row?.entries?.map(({ item }) => item.id) || [];
  const allSelected = ids.length > 0 && ids.every((id) => next[id]);
  for (const id of ids) {
    if (allSelected) delete next[id];
    else next[id] = true;
  }
  return next;
}
