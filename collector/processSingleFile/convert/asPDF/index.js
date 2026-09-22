const { v4 } = require("uuid");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
} = require("../../../utils/files");
const { tokenizeString } = require("../../../utils/tokenizer");
const { default: slugify } = require("slugify");
const PDFLoader = require("./PDFLoader");
const OCRLoader = require("../../../utils/OCRLoader");

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
  const pages = [];
  let docs = await pdfLoader.load();

  if (docs.length === 0) {
    console.log(
      `[asPDF] No text content found for ${filename}. Will attempt OCR parse.`
    );
    docs = await new OCRLoader({
      targetLanguages: options?.ocr?.langList,
    }).ocrPDF(fullFilePath);
  }

  for (const doc of docs) {
    console.log(
      `-- Parsing content from pg ${
        doc.metadata?.loc?.pageNumber || "unknown"
      } --`
    );
    if (!doc.pageContent || !doc.pageContent.length) continue;
    pages.push({
      pageContent: doc.pageContent,
      page: Number.isInteger(doc.metadata?.loc?.pageNumber)
        ? doc.metadata.loc.pageNumber
        : null,
    });
  }

  if (!pages.length) {
    console.error(`[asPDF] Resulting text content was empty for ${filename}.`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
    };
  }

  const documentId = metadata.document_id || v4();
  const documents = pages.map(({ pageContent, page }, index) => {
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
