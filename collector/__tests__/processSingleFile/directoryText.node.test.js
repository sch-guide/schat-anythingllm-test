const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isDirectoryDocument,
  joinWithCellGaps,
  normalizeDirectoryText,
} = require("../../processSingleFile/convert/asPDF/directoryText");

// 가짜 이름·번호만 사용. x: 시작 위치, width: 글자 폭, y: 줄 위치
const item = (str, x, width, y = 700) => ({ str, transform: [1, 0, 0, 1, x, y], width, height: 9 });

test("제목에 전화번호부가 있는 문서만 대상", () => {
  assert.equal(isDirectoryDocument("붙임 2. 2026년도 원내 전화번호부(2026.09.01).pdf"), true);
  assert.equal(isDirectoryDocument("실무지침서_수혈간호.pdf"), false);
});

test("같은 줄의 표 칸 사이 간격을 공백으로 살림", () => {
  const items = [item("홍길동", 10, 27), item("1234", 40, 20), item("5678", 64, 20), item("김철수", 95, 27), item("시설팀", 10, 27, 680), item("9012", 45, 20, 680)];
  assert.equal(joinWithCellGaps(items), "홍길동 1234 5678 김철수\n시설팀 9012");
  // 간격 없이 이어진 글자는 그대로 붙임
  assert.equal(joinWithCellGaps([item("간호", 10, 18), item("부", 28, 9)]), "간호부");
});

test("한 글자씩 띄운 이름을 붙이고 한글·숫자 사이를 띄움", () => {
  assert.equal(normalizeDirectoryText("홍 길 동 1234 5678"), "홍길동 1234 5678");
  assert.equal(normalizeDirectoryText("가 나 다1234김철수5678"), "가나다 1234 김철수 5678");
  assert.equal(normalizeDirectoryText("시설팀 9012\n간호부"), "시설팀 9012\n간호부");
});

test("부서 이름 앞뒤로 붙은 이름도 나눔", () => {
  assert.equal(normalizeDirectoryText("가 나 다 외과라마바1417 3632"), "가나다 외과 라마바 1417 3632");
  assert.equal(normalizeDirectoryText("간호부홍길동 1234"), "간호부 홍길동 1234");
  // 이름 자체에 '부·실' 같은 글자가 있어도 쪼개지 않음
  assert.equal(normalizeDirectoryText("이부선 1234 홍실희 5678"), "이부선 1234 홍실희 5678");
});
