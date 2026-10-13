// 전화번호부 PDF 전용 글자 정리.
// 표로 된 전화번호부는 같은 줄의 칸들이 공백 없이 붙어서 읽혀
// (예: "홍길동12345678김철수…") 이름·부서로 찾거나 번호를 짝지을 수 없음.
// 제목에 "전화번호부"가 들어간 문서에만 적용하고, 다른 지침 문서는 그대로 읽음.

const DIRECTORY_TITLE = /전화번호부/;

function isDirectoryDocument(title = "") {
  return DIRECTORY_TITLE.test(String(title).normalize("NFC"));
}

// 같은 줄에서 화면상 간격이 있는 칸 사이에 공백을 넣어 이어 붙임.
function joinWithCellGaps(items = []) {
  let lastY;
  let lastEnd;
  const out = [];
  for (const item of items) {
    if (!("str" in item)) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    if (lastY === undefined) out.push(item.str);
    else if (y !== lastY) out.push(`\n${item.str}`);
    else {
      const gap = x - lastEnd;
      const needsSpace =
        gap > Math.max(1, (item.height || 8) * 0.15) &&
        !/\s$/.test(out[out.length - 1] || "") &&
        !/^\s/.test(item.str);
      out.push((needsSpace ? " " : "") + item.str);
    }
    lastY = y;
    lastEnd = x + (item.width || 0);
  }
  return out.join("");
}

function normalizeDirectoryText(text = "") {
  return (
    String(text)
      .normalize("NFC")
      // 한 글자씩 띄어진 이름을 붙임: "홍 길 동 1234" → "홍길동 1234",
      // 뒤에 부서 이름이 오는 경우도 포함: "홍 길 동 외과" → "홍길동 외과"
      .replace(
        /([가-힣])((?: [가-힣](?![가-힣])){1,4})(?=\s*(?:[^가-힣\s]|[가-힣]{2,}|$))/gm,
        (run) => run.replace(/ /g, "")
      )
      // 남은 한글·숫자 사이를 띄움: "홍길동1234" → "홍길동 1234"
      .replace(/([가-힣])(?=\d)/g, "$1 ")
      .replace(/(\d)(?=[가-힣])/g, "$1 ")
      // 부서 이름에 붙은 사람 이름을 띄움(뒤에 번호가 올 때만):
      // "외과홍길동 1234" → "외과 홍길동 1234"
      .replace(/(과|팀|실|센터|병동|부)(?=[가-힣]{2,4} \d)/g, "$1 ")
  );
}

module.exports = { isDirectoryDocument, joinWithCellGaps, normalizeDirectoryText };
