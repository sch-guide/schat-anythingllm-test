export const PDF_POSITION_UNAVAILABLE =
  "정확한 위치를 찾지 못해 원문을 표시합니다.";
const compact = (text) => String(text).replace(/\s/gu, "");
const missing = () => ({ matched: false, rects: [] });

export function sourceHighlightTexts(source = {}) {
  const values = Array.isArray(source.highlightTexts)
    ? source.highlightTexts
    : [source.text || source.excerpt || ""];
  return [
    ...new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) =>
          value
            .replace(
              /^\s*<document_metadata>[\s\S]*?<\/document_metadata>\s*/u,
              ""
            )
            .trim()
        )
        .filter(Boolean)
    ),
  ];
}

export function mergeHighlightTexts(...sources) {
  return [...new Set(sources.flatMap(sourceHighlightTexts))];
}

export async function inspectPdfEvidence(pdf, page, texts) {
  const valid =
    Number.isInteger(Number(page)) &&
    Number(page) > 0 &&
    Number(page) <= pdf.numPages;
  const pageNumber = valid ? Number(page) : 1;
  try {
    if (!valid) return { ...missing(), page: pageNumber };
    const pdfPage = await pdf.getPage(pageNumber);
    return {
      ...findEvidenceHighlights(await pdfPage.getTextContent(), texts),
      page: pageNumber,
    };
  } catch {
    return { ...missing(), page: pageNumber };
  }
}

// Exact, page-local matching only. Do not guess glyph positions within an item,
// reading order of tables, repeated passages, or unsupported text directions.
export function findEvidenceHighlights(content, texts) {
  if (!Array.isArray(texts) || !texts.length) return missing();
  let full = "";
  const runs = [];
  for (const item of content.items || []) {
    if (typeof item.str !== "string") continue;
    const text = compact(item.str);
    if (!text) continue;
    runs.push({ item, start: full.length, end: full.length + text.length });
    full += text;
  }
  const selected = new Set();
  for (const text of texts) {
    const needle = compact(text);
    const start = needle ? full.indexOf(needle) : -1;
    if (start < 0 || full.indexOf(needle, start + 1) >= 0) return missing();
    const end = start + needle.length;
    const overlapping = runs.filter(
      (run) => run.start < end && run.end > start
    );
    if (overlapping[0]?.start !== start || overlapping.at(-1)?.end !== end)
      return missing();
    for (const run of overlapping) selected.add(run);
  }
  const rects = [];
  for (const { item } of [...selected].sort((a, b) => a.start - b.start)) {
    const style = content.styles?.[item.fontName] || {};
    const [a, b, c, d, x, y] = item.transform || [];
    if (
      ![a, b, c, d, x, y, item.width].every(Number.isFinite) ||
      a <= 0 ||
      d <= 0 ||
      Math.abs(b) > 0.001 ||
      Math.abs(c) > 0.001 ||
      item.width <= 0 ||
      style.vertical ||
      item.dir === "rtl"
    )
      return missing();
    const ascent = Number.isFinite(style.ascent) ? style.ascent : 0.8;
    const descent = Number.isFinite(style.descent) ? style.descent : -0.2;
    rects.push([x, y + descent * d, x + item.width, y + ascent * d]);
  }
  return rects.length ? { matched: true, rects } : missing();
}

// pdf.js 4.8 serializable annotation format; verified by reopening saved PDFs.
export function highlightAnnotations(rects, page) {
  return rects.map(([x1, y1, x2, y2]) => ({
    annotationType: 9,
    color: [255, 255, 0],
    opacity: 0.35,
    pageIndex: page - 1,
    rotation: 0,
    rect: [x1, y1, x2, y2],
    quadPoints: [x1, y2, x2, y2, x1, y1, x2, y1],
    outlines: [[x1, y1, x2, y1, x2, y2, x1, y2]],
  }));
}

export async function saveHighlightedPdf(pdf, page, rects) {
  const keys = [];
  try {
    highlightAnnotations(rects, page).forEach((annotation, index) => {
      const key = `pdfjs_internal_editor_schat_${index}`;
      keys.push(key);
      pdf.annotationStorage.setValue(key, annotation);
    });
    return await pdf.saveDocument();
  } finally {
    keys.forEach((key) => pdf.annotationStorage.remove(key));
  }
}

export function pdfHighlightUrl(objectUrl, page, position) {
  if (!objectUrl) return "";
  const validPage =
    Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  const destination = position
    ? `zoom=100,${Math.max(0, Math.floor(position[0]))},${Math.max(0, Math.floor(position[1] - 16))}`
    : "view=FitH";
  return `${objectUrl}#page=${validPage}&${destination}`;
}
