// 원본 PDF를 새 창에서 연다(2026-11-09, 휴대폰 근거 화면·지침서 원본 보기).
// 휴대폰 브라우저는 누른 뒤 원본을 받아 오는 동안 새 창을 막을 수 있어, 누르는 순간 빈 창을 먼저
// 열고 받아 온 PDF를 그 창에 띄운다. 새 창이 막히면 false를 돌려준다.

export function pdfPageUrl(objectUrl, page) {
  if (!objectUrl) return "";
  const value = Math.trunc(Number(page));
  return `${objectUrl}#page=${Number.isFinite(value) && value > 0 ? value : 1}`;
}

/**
 * @param {() => Promise<Blob>} loadBlob 원본 PDF를 받아 오는 함수
 * @param {number} page 열 쪽
 * @returns {Promise<boolean>} 새 창에 띄웠으면 true
 */
export async function openPdfInNewWindow(loadBlob, page, win = window) {
  const opened = win.open("", "_blank");
  if (!opened) return false;
  try {
    opened.document.title = "원본 PDF";
    opened.document.body.textContent = "원본 PDF를 여는 중입니다.";
  } catch {
    /* 다른 창의 문서를 못 건드리는 브라우저도 있다. */
  }
  try {
    const blob = await loadBlob();
    if (!blob || (blob.type && blob.type !== "application/pdf"))
      throw new Error("not a pdf");
    const url = win.URL.createObjectURL(
      blob.type ? blob : new Blob([blob], { type: "application/pdf" })
    );
    opened.location.href = pdfPageUrl(url, page);
    return true;
  } catch {
    try {
      opened.close();
    } catch {
      /* ignore */
    }
    return false;
  }
}
