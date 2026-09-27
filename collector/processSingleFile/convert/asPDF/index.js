const { v4 } = require("uuid");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
  documentsFolder,
} = require("../../../utils/files");
const path = require("path");
const { tokenizeString } = require("../../../utils/tokenizer");
const { default: slugify } = require("slugify");
const PDFLoader = require("./PDFLoader");
const OCRLoader = require("../../../utils/OCRLoader");
const {
  extractPdfRasterImages,
  persistPdfImages,
  createGeminiImageDescriber,
  buildPageImageMetadata,
  resolveDescriptionProcessingLimits,
} = require("./pdfImages");

async function asPdf({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  const pdfLoader = new PDFLoader(fullFilePath, {
    splitPages: true,
  });

  console.log(`-- Working ${filename} --`);
  const documentId = metadata.document_id || v4();
  const pagesByNumber = new Map();
  let docs = await pdfLoader.load();

  if (docs.length === 0) {
    console.log(
      `[asPDF] No text content found for ${filename}. Will attempt OCR parse.`
    );
    docs = await new OCRLoader({
      targetLanguages: options?.ocr?.langList,
    }).ocrPDF(fullFilePath);
  }

  let persistedImages = [];
  if (
    !options.parseOnly &&
    process.env.SCHAT_PDF_IMAGE_ENABLED !== "false"
  ) {
    try {
      const extractedImages = await extractPdfRasterImages(fullFilePath);
      const descriptionsEnabled =
        process.env.SCHAT_PDF_IMAGE_DESCRIPTION_ENABLED !== "false";
      let describeImage = null;
      if (descriptionsEnabled) {
        try {
          describeImage = createGeminiImageDescriber();
        } catch (error) {
          console.warn(
            `[asPDF] Image descriptions disabled for ${filename}: ${error.message}`
          );
        }
      }
      const descriptionLimits = resolveDescriptionProcessingLimits();
      persistedImages = await persistPdfImages({
        documentId,
        images: extractedImages,
        storageRoot: path.resolve(documentsFolder, "../document-images"),
        describeImage,
        maxDescriptions: descriptionLimits.maxPerRun,
        batchSize: descriptionLimits.batchSize,
      });
    } catch (error) {
      console.warn(
        `[asPDF] Image processing skipped for ${filename}: ${error.message}`
      );
      persistedImages = [];
    }
  }

  for (const doc of docs) {
    console.log(
      `-- Parsing content from pg ${
        doc.metadata?.loc?.pageNumber || "unknown"
      } --`
    );
    if (!doc.pageContent || !doc.pageContent.length) continue;
    const page = Number.isInteger(doc.metadata?.loc?.pageNumber)
      ? doc.metadata.loc.pageNumber
      : null;
    pagesByNumber.set(page, {
      pageContent: doc.pageContent,
      page,
    });
  }

  for (const image of persistedImages) {
    if (!pagesByNumber.has(image.page)) {
      pagesByNumber.set(image.page, { pageContent: "", page: image.page });
    }
  }
  const pages = Array.from(pagesByNumber.values()).sort(
    (left, right) => (left.page || 0) - (right.page || 0)
  );

  if (!pages.length) {
    console.error(`[asPDF] Resulting text content was empty for ${filename}.`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
    };
  }

  const documents = pages.map(({ pageContent, page }, index) => {
    const pdfImages = buildPageImageMetadata(
      persistedImages.filter((image) => image.page === page)
    );
    const data = {
      id: v4(),
      document_id: documentId,
      url: "file://" + fullFilePath,
      title: metadata.title || filename,
      docAuthor:
        metadata.docAuthor ||
        docs[0]?.metadata?.pdf?.info?.Creator ||
        "no author found",
      description:
        metadata.description ||
        docs[0]?.metadata?.pdf?.info?.Title ||
        "No description found.",
      docSource: metadata.docSource || "pdf file uploaded by the user.",
      chunkSource: metadata.chunkSource || "",
      usage_scope: metadata.usage_scope || "employee",
      document_version: metadata.document_version || "",
      ...(Number.isInteger(page) ? { page } : {}),
      section: typeof metadata.section === "string" ? metadata.section : "",
      published: createdDate(fullFilePath),
      wordCount: pageContent.split(" ").length,
      pageContent,
      token_count_estimate: tokenizeString(pageContent),
      ...(pdfImages.length ? { pdf_images: pdfImages } : {}),
    };
    return writeToServerDocuments({
      data,
      filename: `${slugify(filename)}-page-${page || index + 1}-${data.id}`,
      options: { parseOnly: options.parseOnly },
    });
  });
  if (!options.absolutePath) trashFile(fullFilePath);
  console.log(`[SUCCESS]: ${filename} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents };
}

module.exports = asPdf;
