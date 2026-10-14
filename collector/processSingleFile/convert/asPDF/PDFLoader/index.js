const fs = require("fs").promises;

// 쪽당 평균 이만큼(공백 제외)도 못 읽으면 최신 pdf.js로 다시 읽어 봄.
const THIN_TEXT_PER_PAGE = 20;
function textLength(documents = []) {
  return documents.reduce(
    (sum, doc) => sum + String(doc.pageContent || "").replace(/\s+/g, "").length,
    0
  );
}

class PDFLoader {
  // directoryLayout: 전화번호부처럼 표로 된 문서는 칸 사이 간격을 공백으로 살림.
  constructor(filePath, { splitPages = true, directoryLayout = false } = {}) {
    this.filePath = filePath;
    this.splitPages = splitPages;
    this.directoryLayout = directoryLayout;
  }

  async load() {
    const buffer = await fs.readFile(this.filePath);
    let result = await this.readPages(buffer, await this.getPdfJS());
    // 한컴 PDF처럼 옛 pdf.js(1.10)가 글자를 못 읽는 문서가 있음. 그때만 최신
    // pdf.js로 한 번 더 읽고, 글자가 더 많이 나오면 그 결과를 씀.
    // 잘 읽히는 PDF는 지금과 똑같이 처리됨(OCR로 넘어가기 전 단계).
    if (textLength(result.documents) < THIN_TEXT_PER_PAGE * result.numPages) {
      try {
        const modern = await this.readPages(buffer, await this.getModernPdfJS());
        if (textLength(modern.documents) > textLength(result.documents)) {
          console.log(
            `[PDFLoader] pdf.js ${result.version}에서 글자를 거의 읽지 못해 pdf.js ${modern.version} 결과를 사용합니다.`
          );
          result = modern;
        }
      } catch (error) {
        console.error("[PDFLoader] 최신 pdf.js로 다시 읽기 실패:", error.message);
      }
    }
    const { documents, meta, version } = result;

    if (this.splitPages) {
      return documents;
    }

    if (documents.length === 0) {
      return [];
    }

    return [
      {
        pageContent: documents.map((doc) => doc.pageContent).join("\n\n"),
        metadata: {
          source: this.filePath,
          pdf: {
            version,
            info: meta?.info,
            metadata: meta?.metadata,
            totalPages: result.numPages,
          },
        },
      },
    ];
  }

  async readPages(buffer, { getDocument, version }) {
    const pdf = await getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0,
    }).promise;

    const meta = await pdf.getMetadata().catch(() => null);
    const documents = [];

    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      if (content.items.length === 0) {
        continue;
      }

      let text;
      if (this.directoryLayout) {
        const {
          joinWithCellGaps,
          normalizeDirectoryText,
        } = require("../directoryText");
        text = normalizeDirectoryText(joinWithCellGaps(content.items));
      } else {
        let lastY;
        const textItems = [];
        for (const item of content.items) {
          if ("str" in item) {
            if (lastY === item.transform[5] || !lastY) {
              textItems.push(item.str);
            } else {
              textItems.push(`
${item.str}`);
            }
            lastY = item.transform[5];
          }
        }
        text = textItems.join("");
      }
      documents.push({
        pageContent: text.trim(),
        metadata: {
          source: this.filePath,
          pdf: {
            version,
            info: meta?.info,
            metadata: meta?.metadata,
            totalPages: pdf.numPages,
          },
          loc: { pageNumber: i },
        },
      });
    }
    return { documents, meta, version, numPages: pdf.numPages };
  }

  async getModernPdfJS() {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    return { getDocument: pdfjs.getDocument, version: pdfjs.version };
  }

  async getPdfJS() {
    try {
      const pdfjs = await import("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
      return { getDocument: pdfjs.getDocument, version: pdfjs.version };
    } catch (e) {
      console.error(e);
      throw new Error(
        "Failed to load pdf-parse. Please install it with eg. `npm install pdf-parse`."
      );
    }
  }
}

module.exports = PDFLoader;
