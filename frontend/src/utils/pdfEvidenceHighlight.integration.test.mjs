import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  completeWithEvidence,
  evidenceSourceId,
} = require("../../../server/utils/agents/aibitat/utils/evidenceQuotes.js");
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  findEvidenceHighlights,
  answerHighlightTexts,
  drawEvidenceHighlights,
  saveHighlightedPdf,
} from "./pdfEvidenceHighlight.js";

// Tiny synthetic PDF, never a hospital document. Explicit text items and table.
function syntheticPdf(rotation = 0) {
  const stream =
    "BT /F1 12 Tf 10 180 Td (Alpha beta) Tj 0 -20 Td (Gamma) Tj 0 -20 Td (Drug) Tj 80 0 Td (10 mg) Tj 80 0 Td (IV) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Rotate ${rotation} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

for (const rotation of [0, 90, 180, 270]) {
  test(`real PDF roundtrip preserves source, text, rotation ${rotation} and readable pale green line highlights`, async () => {
    const original = syntheticPdf(rotation);
    const hash = createHash("sha256").update(original).digest("hex");
    const task = getDocument({
      data: original.slice(),
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await task.promise;
    let saved;
    try {
      const page = await pdf.getPage(1);
      const result = findEvidenceHighlights(await page.getTextContent(), [
        "Alpha beta\nGamma\nDrug\t10 mg\tIV",
      ]);
      assert.equal(result.matched, true);
      saved = await saveHighlightedPdf(pdf, 1, result.paintRects);
      assert.equal(pdf.annotationStorage.size, 0);
      assert.equal(createHash("sha256").update(original).digest("hex"), hash);
    } finally {
      await task.destroy();
    }
    if (process.env.SCHAT_HIGHLIGHT_ARTIFACT_DIR && rotation === 0) {
      const directory = process.env.SCHAT_HIGHLIGHT_ARTIFACT_DIR;
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "original.pdf"), original);
      await writeFile(path.join(directory, "highlighted.pdf"), saved);
    }
    const reopenedTask = getDocument({
      data: saved,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    try {
      const reopened = await reopenedTask.promise;
      const page = await reopened.getPage(1);
      assert.equal(page.rotate, rotation);
      const annotations = await page.getAnnotations();
      assert.equal(annotations.length, 5);
      assert.ok(
        annotations.every(
          (annotation) =>
            annotation.subtype === "Highlight" &&
            annotation.color.every((channel, index) =>
              Math.abs(
                Math.round(
                  255 * (1 - annotation.opacity) + channel * annotation.opacity
                ) - [230, 247, 200][index]
              ) <= 1
            )
        )
      );
      // The saved desktop PDF must darken the original ink rather than wash it out.
      const operators = await page.getOperatorList();
      const graphicsStates = operators.fnArray.flatMap((operation, index) =>
        operation === OPS.setGState ? operators.argsArray[index][0] : []
      );
      assert.ok(
        graphicsStates.some(([key, value]) => key === "BM" && value === "multiply")
      );
      assert.ok(
        graphicsStates.some(([key, value]) => key === "ca" && value === 0.25)
      );
      assert.match(
        (await page.getTextContent()).items.map((item) => item.str).join(" "),
        /Alpha beta/
      );
      // Page rotation must be applied identically to desktop destinations/mobile rectangles.
      const rectangle = page
        .getViewport({ scale: 2 })
        .convertToViewportRectangle(annotations[0].rect);
      assert.ok(rectangle.every(Number.isFinite));
      // Mobile uses the same PDF coordinates at every zoom/device-pixel scale.
      for (const scale of [1, 1.5, 2, 3, 6, 9]) {
        const viewport = page.getViewport({ scale });
        const calls = [];
        const context = {
          save() {},
          restore() {},
          fillRect(...args) {
            calls.push(args);
          },
        };
        drawEvidenceHighlights(context, viewport, [annotations[0].rect]);
        assert.equal(context.globalCompositeOperation, "multiply");
        const mobileColor = context.fillStyle.match(/\d+/g).map(Number);
        assert.deepEqual(
          mobileColor.map((channel) =>
            Math.round(
              255 * (1 - context.globalAlpha) + channel * context.globalAlpha
            )
          ),
          [230, 247, 200]
        );
        const [x, y, width, height] = calls[0];
        const a = viewport.convertToPdfPoint(x, y),
          b = viewport.convertToPdfPoint(x + width, y + height);
        const roundtrip = [
          Math.min(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.max(a[0], b[0]),
          Math.max(a[1], b[1]),
        ];
        roundtrip.forEach((value, index) =>
          assert.ok(Math.abs(value - annotations[0].rect[index]) < 0.001)
        );
      }
    } finally {
      await reopenedTask.destroy();
    }
  });
}

test("recorded quotes connect a paraphrased answer to only the supporting PDF region", async () => {
  const source = {
    documentName: "synthetic.pdf",
    page: 1,
    text: "Alpha beta\nGamma\nDrug 10 mg IV",
  };
  const quote = "Alpha beta\nGamma";
  const sources = [source];
  await completeWithEvidence({
    sources,
    messages: [{ role: "user", content: "Synthetic procedure question" }],
    functions: [],
    provider: {
      complete: async () => ({
        textResponse:
          "Read the first two synthetic entries.<schat_evidence>" +
          JSON.stringify({
            quotes: [{ source_id: evidenceSourceId(source), text: quote }],
          }) +
          "</schat_evidence>",
      }),
    },
  });
  const task = getDocument({
    data: syntheticPdf(),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const result = findEvidenceHighlights(
      content,
      answerHighlightTexts(source, "Read the first two synthetic entries.")
    );
    assert.equal(result.matched, true);
    assert.equal(result.rects.length, 1);
    // The table below the selected sentences must stay outside the box.
    assert.ok(result.rects[0][1] > 145);
  } finally {
    await task.destroy();
  }
});
