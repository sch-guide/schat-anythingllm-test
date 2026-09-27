const fs = require("node:fs");
const path = require("node:path");

// The collector already ships pdf.js (through pdf-parse) and uses it to create
// the page text stored for every PDF. The server only reads glyph positions
// from the same library so no new dependency is introduced. When it cannot be
// loaded, checklist extraction is skipped and PDF registration is unaffected.
const PDFJS_RELATIVE = "pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js";

let cachedPdfjs;

function loadPdfjs() {
  if (cachedPdfjs !== undefined) return cachedPdfjs;
  const searchRoots = [
    process.env.SCHAT_PDFJS_ROOT,
    path.resolve(__dirname, "../../../collector"),
    path.resolve(__dirname, "../../../collector/node_modules"),
    "/app/collector",
  ].filter(Boolean);
  cachedPdfjs = null;
  for (const root of searchRoots) {
    try {
      const resolved = require.resolve(PDFJS_RELATIVE, { paths: [root] });
      cachedPdfjs = require(resolved);
      break;
    } catch {
      // try the next location
    }
  }
  return cachedPdfjs;
}

function toItem(item) {
  const [, , , d, x, y] = item.transform;
  return {
    str: String(item.str || ""),
    x: Number(x),
    y: Number(y),
    w: Number(item.width) || 0,
    h: Math.abs(Number(d)) || 0,
  };
}

/**
 * Reads positioned text items for the requested 1-based page numbers.
 * Returns Map<page, { width, height, items }> in content-stream order.
 */
async function readPdfPageLayouts(pdfPath, pages = []) {
  const pdfjs = loadPdfjs();
  if (!pdfjs || !pdfPath || !fs.existsSync(pdfPath)) return new Map();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const task = pdfjs.getDocument({ data });
  const document = task.promise ? await task.promise : await task;
  const layouts = new Map();
  try {
    for (const pageNumber of [...new Set(pages.map(Number))]) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1) continue;
      if (pageNumber > document.numPages) continue;
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport(1);
      const content = await page.getTextContent({ normalizeWhitespace: false });
      layouts.set(pageNumber, {
        width: viewport.width,
        height: viewport.height,
        items: content.items.map(toItem).filter((item) => item.str !== ""),
      });
    }
  } finally {
    await document.destroy?.();
  }
  return layouts;
}

module.exports = { readPdfPageLayouts, loadPdfjs };
