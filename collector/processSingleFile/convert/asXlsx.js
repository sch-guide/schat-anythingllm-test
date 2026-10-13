const { v4 } = require("uuid");
const xlsx = require("node-xlsx").default;
const path = require("path");
const fs = require("fs");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
  documentsFolder,
} = require("../../utils/files");
const { tokenizeString } = require("../../utils/tokenizer");
const { default: slugify } = require("slugify");
const { spreadsheetText } = require("./spreadsheetText");

async function asXlsx({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  const documents = [];
  const documentId = metadata.document_id || v4();

  try {
    // Read displayed values: retain number formats such as 0000 and text zeros.
    // Formula cached values are read; macros/formulas are not executed.
    const workSheetsFromFile = xlsx.parse(fullFilePath, { raw: false, defval: "" });

    if (options.parseOnly) {
      const allSheetContents = [];
      let totalWordCount = 0;
      const sheetNames = [];

      for (const sheet of workSheetsFromFile) {
        const processed = processSheet(sheet);
        if (!processed) continue;

        const { name, content, wordCount } = processed;
        sheetNames.push(name);
        allSheetContents.push(`\nSheet: ${name}\n${content}`);
        totalWordCount += wordCount;
      }

      if (allSheetContents.length === 0) {
        console.log(`No valid sheets found in ${filename}.`);
        return {
          success: false,
          reason: `No valid sheets found in ${filename}.`,
          documents: [],
        };
      }

      const combinedContent = allSheetContents.join("\n");
      const combinedData = {
        id: v4(),
        document_id: documentId,
        url: `file://${fullFilePath}`,
        title: metadata.title || filename,
        section: `시트: ${sheetNames.join(", ")}`,
        docAuthor: metadata.docAuthor || "Unknown",
        description:
          metadata.description ||
          `Spreadsheet data from ${filename} containing ${sheetNames.length} ${
            sheetNames.length === 1 ? "sheet" : "sheets"
          }`,
        docSource: metadata.docSource || "an xlsx file uploaded by the user.",
        chunkSource: metadata.chunkSource || "",
        published: createdDate(fullFilePath),
        wordCount: totalWordCount,
        pageContent: combinedContent,
        token_count_estimate: tokenizeString(combinedContent),
      };

      const document = writeToServerDocuments({
        data: combinedData,
        filename: `${slugify(path.basename(filename))}-${combinedData.id}`,
        destinationOverride: null,
        options: { parseOnly: true },
      });
      documents.push(document);
      console.log(`[SUCCESS]: ${filename} converted & ready for embedding.`);
    } else {
      const folderName = slugify(
        `${path.basename(filename)}-${v4().slice(0, 4)}`,
        {
          lower: true,
          trim: true,
        }
      );
      const outFolderPath = path.resolve(documentsFolder, folderName);
      if (!fs.existsSync(outFolderPath))
        fs.mkdirSync(outFolderPath, { recursive: true });

      for (const sheet of workSheetsFromFile) {
        const processed = processSheet(sheet);
        if (!processed) continue;

        const { name, content, wordCount } = processed;
        const sheetData = {
          id: v4(),
          document_id: documentId,
          url: `file://${path.join(outFolderPath, `${slugify(name)}.csv`)}`,
          title: metadata.title || filename,
          section: `시트: ${name}`,
          docAuthor: metadata.docAuthor || "Unknown",
          description:
            metadata.description || `Spreadsheet data from sheet: ${name}`,
          docSource: metadata.docSource || "an xlsx file uploaded by the user.",
          chunkSource: metadata.chunkSource || "",
          published: createdDate(fullFilePath),
          wordCount: wordCount,
          pageContent: content,
          token_count_estimate: tokenizeString(content),
        };

        const document = writeToServerDocuments({
          data: sheetData,
          filename: `sheet-${slugify(name) || "sheet"}-${sheetData.id}`,
          destinationOverride: outFolderPath,
          options: { parseOnly: options.parseOnly },
        });
        documents.push(document);
        console.log(
          `[SUCCESS]: Sheet "${name}" converted & ready for embedding.`
        );
      }
    }
    if(documents.length && !options.parseOnly) {
      require("./originalSpreadsheet").persistSpreadsheet({
        sourcePath:fullFilePath,documentId,filename:metadata.title||filename,
        storageRoot:path.resolve(documentsFolder,"../original-spreadsheets"),
      });
    }
  } catch (err) {
    console.error("Could not process xlsx file!", err);
    return {
      success: false,
      reason: `Error processing ${filename}: ${err.message}`,
      documents: [],
    };
  } finally {
    if (!options.absolutePath) trashFile(fullFilePath);
  }

  if (documents.length === 0) {
    console.error(`No valid sheets found in ${filename}.`);
    return {
      success: false,
      reason: `No valid sheets found in ${filename}.`,
      documents: [],
    };
  }

  console.log(
    `[SUCCESS]: ${filename} fully processed. Created ${documents.length} document(s).\n`
  );
  return { success: true, reason: null, documents };
}

/**
 * Processes a single sheet and returns its content and metadata
 * @param {{name: string, data: Array<Array<string|number|null|undefined>>}} sheet - Parsed sheet with name and 2D array of cell values
 * @returns {{name: string, content: string, wordCount: number}|null} - Labeled rows, or null if sheet is empty
 */
function processSheet(sheet) {
  try {
    const { name, data } = sheet;
    const content = spreadsheetText({ name, data });

    if (!content?.length) {
      console.log(`Sheet "${name}" is empty. Skipping.`);
      return null;
    }

    console.log(`-- Processing sheet: ${name} --`);
    return {
      name,
      content,
      wordCount: content.split(/\s+/).length,
    };
  } catch (err) {
    console.error(`Error processing sheet "${sheet.name}":`, err);
    return null;
  }
}

module.exports = asXlsx;
