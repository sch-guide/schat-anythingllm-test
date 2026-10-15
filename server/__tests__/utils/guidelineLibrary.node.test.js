// 2026-10-15 결정: 챗봇용 문서(문서 등록)는 챗봇 답변에만 쓰고,
// 지침서 원본 보기에는 관리자가 '지침서 원본 자료'에 올린 PDF만 보인다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "../../endpoints/workspaces.js"),
  "utf8"
);
function route(name) {
  const start = source.indexOf(`"/workspace/:slug/${name}"`);
  assert.ok(start > 0, name);
  return source.slice(start, source.indexOf("app.get(", start + 10));
}

test("원본 보기 목록은 자료실 문서만 돌려주고 챗봇 문서는 넣지 않는다", () => {
  const list = route("guideline-originals");
  assert.match(list, /listLibraryItems\(\)/);
  assert.match(list, /kind: "library"/);
  assert.doesNotMatch(list, /Document\.forWorkspace|kind: "registered"|pdfRef/);
});

test("원본 보기 글자 검색도 자료실 문서만 찾는다", () => {
  const search = route("guideline-search");
  assert.match(search, /libraryPageTexts\(\)/);
  assert.doesNotMatch(search, /Document\.forWorkspace|registered/);
});

test("검색 도구는 자료 검색 함수만 내보낸다", () => {
  assert.deepEqual(Object.keys(require("../../utils/guidelineLibrary")).sort(), [
    "compileQuery",
    "searchPageTexts",
  ]);
});
