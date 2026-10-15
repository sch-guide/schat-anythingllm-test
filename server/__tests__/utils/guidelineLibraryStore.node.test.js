const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");
const Store = require("../../utils/guidelineLibraryStore");
const { searchPageTexts, compileQuery } = require("../../utils/guidelineLibrary");

const pdf = Buffer.from("%PDF-1.7\n가짜 PDF 내용");
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), "schat-library-"));

test("보기 전용 자료를 저장하고 목록에는 글자 본문 없이 보여 준다", async () => {
  const storageRoot = fresh();
  const item = await Store.saveLibraryItem(
    { buffer: pdf, filename: "인터벤션 안내.pdf", pages: [{ page: 1, text: "TACE 준비" }, { page: 9, text: "범위 밖" }] },
    { storageRoot, countPages: async () => 2 }
  );
  assert.equal(item.title, "인터벤션 안내");
  assert.equal(item.pageCount, 2);
  assert.equal(item.textPages, 1);
  const list = Store.listLibraryItems({ storageRoot });
  assert.equal(list.length, 1);
  assert.equal("pages" in list[0], false);
  assert.ok(Store.libraryPdfPath(item.id, { storageRoot }));
  assert.deepEqual(Store.libraryPageTexts({ storageRoot })[0].pages, [{ page: 1, text: "TACE 준비" }]);
});

test("PDF가 아니거나 읽을 수 없거나 너무 크면 저장하지 않는다", async () => {
  const storageRoot = fresh();
  await assert.rejects(Store.saveLibraryItem({ buffer: Buffer.from("hello") }, { storageRoot }), /PDF 파일만/);
  await assert.rejects(
    Store.saveLibraryItem({ buffer: pdf }, { storageRoot, countPages: async () => { throw new Error("bad"); } }),
    /읽지 못했습니다/
  );
  await assert.rejects(
    Store.saveLibraryItem({ buffer: Buffer.alloc(Store.MAX_PDF_BYTES + 1) }, { storageRoot }),
    /100MB/
  );
  assert.deepEqual(Store.listLibraryItems({ storageRoot }), []);
});

test("삭제는 올바른 자료 번호만 받고 파일을 함께 지운다", async () => {
  const storageRoot = fresh();
  const item = await Store.saveLibraryItem({ buffer: pdf, title: "자료" }, { storageRoot, countPages: async () => 1 });
  assert.throws(() => Store.removeLibraryItem("../anythingllm", { storageRoot }), /확인해 주세요/);
  Store.removeLibraryItem(item.id, { storageRoot });
  assert.equal(Store.libraryPdfPath(item.id, { storageRoot }), null);
  assert.deepEqual(Store.listLibraryItems({ storageRoot }), []);
  assert.equal(Store.libraryPdfPath("../../storage/anythingllm.db", { storageRoot }), null);
});

test("검색은 띄어쓰기·대소문자를 무시하고 문서·쪽·앞뒤 글자를 돌려준다", () => {
  const entries = [
    { kind: "registered", ref: "ref-a", title: "검사 및 시술.pdf", page: 66, text: "동맥화학 색전술(TACE) 준비 약품" },
    { kind: "library", ref: "id-b", title: "자료실 안내", page: 2, text: "중심 정맥관 관리" },
    { kind: "registered", ref: "ref-a", title: "검사 및 시술.pdf", page: 3, text: "관계없는 쪽" },
  ];
  const tace = searchPageTexts(entries, "tace");
  assert.deepEqual(tace.hits.map((hit) => [hit.ref, hit.page, hit.snippet.match]), [["ref-a", 66, "TACE"]]);
  assert.equal(searchPageTexts(entries, "중심정맥관").hits[0].ref, "id-b");
  assert.equal(compileQuery(""), null);
  assert.equal(compileQuery("가".repeat(51)), null);
  assert.deepEqual(searchPageTexts(entries, "a.b(").hits, []);
});
