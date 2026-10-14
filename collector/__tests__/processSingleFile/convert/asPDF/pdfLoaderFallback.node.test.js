// 옛 pdf.js(1.10)가 글자를 못 읽는 PDF(예: 한컴 PDF)만 최신 pdf.js로 다시 읽음.
// 가상 pdf.js 대역만 사용(실제 병원 문서 없음).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const PDFLoader = require("../../../../processSingleFile/convert/asPDF/PDFLoader");

function fakePdfJs(version, pages) {
  return {
    version,
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pages.length,
        getMetadata: async () => ({ info: {} }),
        getPage: async (i) => ({
          getTextContent: async () => ({
            items: pages[i - 1]
              ? [{ str: pages[i - 1], transform: [1, 0, 0, 1, 0, 700] }]
              : [],
          }),
        }),
      }),
    }),
  };
}

function loader(legacyPages, modernPages) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pdf-")), "a.pdf");
  fs.writeFileSync(file, "%PDF-");
  const l = new PDFLoader(file);
  let modernCalls = 0;
  l.getPdfJS = async () => fakePdfJs("1.10.100", legacyPages);
  l.getModernPdfJS = async () => {
    modernCalls += 1;
    return fakePdfJs("4.8.69", modernPages);
  };
  return { l, calls: () => modernCalls };
}

test("옛 pdf.js가 글자를 못 읽으면 최신 pdf.js 결과를 씀", async () => {
  const body = "가상 중심정맥관 관리 지침 본문입니다. 드레싱은 정해진 주기에 교환합니다.";
  const { l, calls } = loader(["", "", ""], [body, body, body]);
  const docs = await l.load();
  assert.equal(calls(), 1);
  assert.equal(docs.length, 3);
  assert.match(docs[0].pageContent, /중심정맥관/);
  assert.equal(docs[0].metadata.pdf.version, "4.8.69");
});

test("잘 읽히는 PDF는 최신 pdf.js를 부르지 않고 지금과 같음", async () => {
  const body = "가상 수혈 간호 지침 본문입니다. 두 명이 함께 확인합니다.";
  const { l, calls } = loader([body, body], ["다른 결과", "다른 결과"]);
  const docs = await l.load();
  assert.equal(calls(), 0);
  assert.equal(docs[0].pageContent, body);
  assert.equal(docs[0].metadata.pdf.version, "1.10.100");
});

test("최신 pdf.js도 못 읽으면(그림만 있는 PDF) 예전처럼 빈 결과 → OCR 단계로", async () => {
  const { l, calls } = loader(["", ""], ["", ""]);
  assert.deepEqual(await l.load(), []);
  assert.equal(calls(), 1);
});

test("최신 pdf.js를 불러오지 못해도 기존 결과로 계속 진행", async () => {
  const { l } = loader(["짧음", ""], []);
  l.getModernPdfJS = async () => { throw new Error("not installed"); };
  const docs = await l.load();
  assert.equal(docs.length, 1);
});
