import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  findEvidenceHighlights,
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
  test(`real PDF roundtrip preserves source, text, rotation ${rotation} and yellow annotations`, async () => {
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
        "Alpha beta\nGamma",
        "Drug\t10 mg\tIV",
      ]);
      assert.equal(result.matched, true);
      saved = await saveHighlightedPdf(pdf, 1, result.rects);
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
            annotation.color[0] === 255 &&
            annotation.color[1] === 255 &&
            annotation.color[2] === 0
        )
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
    } finally {
      await reopenedTask.destroy();
    }
  });
}
