export const PDF_POSITION_UNAVAILABLE =
  "정확한 위치를 찾지 못해 원문을 표시합니다.";
export const EVIDENCE_HIGHLIGHT = Object.freeze({
  // With multiply blending on white, this reads as pale green #e6f7c8.
  color: [155, 223, 35],
  opacity: 0.25,
});
export const EVIDENCE_HIGHLIGHT_LABEL =
  "\uC5F0\uB450\uC0C9 \uD45C\uC2DC = \uB2F5\uBCC0\uC5D0 \uC0AC\uC6A9\uB41C \uADFC\uAC70";
const compact = (text) => String(text).replace(/\s/gu, "");
const missing = () => ({ matched: false, rects: [] });

export function sourceHighlightTexts(source = {}) {
  const values = Array.isArray(source.evidenceQuotes)
    ? source.evidenceQuotes
    : Array.isArray(source.highlightTexts)
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

// Only exact answer/source sentence alignment is eligible. Topic similarity
// cannot establish which part of a retrieved page supported an answer.
export function answerHighlightTexts(source = {}, answer = "") {
  if (Array.isArray(source.evidenceQuotes)) return sourceHighlightTexts(source);
  const plainAnswer = String(answer)
    .replace(/\*\*|__|`/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1");
  const answerText = compact(plainAnswer);
  if (!answerText) return [];
  const selected = sourceHighlightTexts(source).flatMap((text) => {
    const regions = [];
    let current = [];
    const flush = () => {
      if (current.length) regions.push(current.join("\n"));
      current = [];
    };
    for (const raw of text.split(/(?<=[.!?\u3002])(?:\s+|$)|\r?\n/gu)) {
      const sentence = raw.trim().replace(/^(?:[-*\u2022]\s+|\d+[.)]\s+)/u, "");
      if (
        compact(sentence).length >= 12 &&
        answerText.includes(compact(sentence))
      )
        current.push(sentence);
      else flush();
    }
    flush();
    return regions;
  });
  return [...new Set(selected)];
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
  const groups = [];
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
    groups.push(overlapping);
  }
  const rects = [];
  const paintRects = [];
  for (const group of groups.sort((a, b) => a[0].start - b[0].start)) {
    const groupRects = [];
    for (const { item } of group) {
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
      groupRects.push([x, y + descent * d, x + item.width, y + ascent * d]);
    }
    paintRects.push(...groupRects);
    rects.push([
      Math.min(...groupRects.map((rect) => rect[0])),
      Math.min(...groupRects.map((rect) => rect[1])),
      Math.max(...groupRects.map((rect) => rect[2])),
      Math.max(...groupRects.map((rect) => rect[3])),
    ]);
  }
  return rects.length
    ? {
        matched: true,
        rects,
        paintRects: [
          ...new Map(paintRects.map((rect) => [rect.join(","), rect])).values(),
        ],
      }
    : missing();
}

// pdf.js 4.8 serializable annotation format; verified by reopening saved PDFs.
export function highlightAnnotations(rects, page) {
  return rects.map(([x1, y1, x2, y2]) => ({
    annotationType: 9,
    color: [...EVIDENCE_HIGHLIGHT.color],
    opacity: EVIDENCE_HIGHLIGHT.opacity,
    pageIndex: page - 1,
    rotation: 0,
    rect: [x1, y1, x2, y2],
    quadPoints: [x1, y2, x2, y2, x1, y1, x2, y1],
    outlines: [[x1, y1, x2, y1, x2, y2, x1, y2]],
  }));
}

export function drawEvidenceHighlights(context, viewport, rects) {
  context.save();
  context.globalCompositeOperation = "multiply";
  context.globalAlpha = EVIDENCE_HIGHLIGHT.opacity;
  context.fillStyle = `rgb(${EVIDENCE_HIGHLIGHT.color.join(",")})`;
  for (const rect of rects) {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
    context.fillRect(
      Math.min(x1, x2),
      Math.min(y1, y2),
      Math.abs(x2 - x1),
      Math.abs(y2 - y1)
    );
  }
  context.restore();
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

export function pdfHighlightUrl(objectUrl, page, position, zoomPercent) {
  if (!objectUrl) return "";
  const validPage =
    Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  if (Number.isFinite(zoomPercent) && zoomPercent > 0) {
    const top = position
      ? Math.max(0, Math.floor(((position[1] - 16) * zoomPercent) / 100))
      : 0;
    return `${objectUrl}#page=${validPage}&zoom=${zoomPercent},0,${top}`;
  }
  const destination = position
    ? `view=FitH,${Math.max(0, Math.floor(position[1] - 16))}`
    : "view=FitH";
  return `${objectUrl}#page=${validPage}&${destination}`;
}

// Display policy only; never changes citation selection or source metadata.
// 연두색 근거 표시는 실무지침서와 전화번호부에만 함(표가 많은 다른 문서는 위치가 부정확).
export function documentEvidenceTexts(documentName, texts) {
  return /실무\s*지침|전화번호부/u.test(String(documentName || "")) ? texts : [];
}
