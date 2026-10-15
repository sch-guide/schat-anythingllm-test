import {
  GlobalWorkerOptions,
  getDocument,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export function openEvidenceDocument(data) {
  return getDocument({ data, isEvalSupported: false, useSystemFonts: true });
}

// 지침서 원본 보기: 큰 PDF(실무지침서 약 40MB)도 보고 있는 쪽만 받아 오도록
// 서버의 부분 전송(Range)을 사용한다. 인증 헤더는 요청마다 붙인다.
export function openGuidelineDocument({ url, httpHeaders }) {
  return getDocument({
    url,
    httpHeaders,
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: 256 * 1024,
    isEvalSupported: false,
    useSystemFonts: true,
  });
}
