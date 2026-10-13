import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  filesToStage,
  filterLibrary,
  libraryStatus,
  uploadedKeys,
} from "./documentLibraryView.js";

const file = (name) => ({ folderName: "custom-documents", name, id: name });
const docs = [
  {
    key: "a",
    title: "검사 및 시술(26.04.07).pdf",
    status: "registered",
    pages: 82,
    freeFiles: [],
    pdfRef: "r",
  },
  {
    key: "b",
    title: "수술(260306).pdf",
    status: "unregistered",
    pages: 2,
    freeFiles: [file("b1.json"), file("b2.json")],
  },
  {
    key: "c",
    title: "검사 및 시술(26.04.07).pdf",
    status: "unregistered",
    olderCopy: true,
    pages: 1,
    freeFiles: [file("c1.json")],
  },
];

test("문서 이름 검색은 띄어쓰기·대소문자와 상관없이 문서 단위로 찾음", () => {
  assert.deepEqual(
    filterLibrary(docs, "검사및시술").map((d) => d.key),
    ["a", "c"]
  );
  assert.deepEqual(
    filterLibrary(docs, " 수술 ").map((d) => d.key),
    ["b"]
  );
  assert.equal(filterLibrary(docs, "").length, 3);
  assert.equal(filterLibrary(docs, "없는문서").length, 0);
});

test("등록됨·등록 전·예전 업로드·등록 대기·처리 중을 구분", () => {
  assert.equal(libraryStatus(docs[0]).label, "등록됨");
  assert.equal(libraryStatus(docs[0]).selectable, false);
  assert.equal(libraryStatus(docs[1]).label, "등록 전");
  assert.equal(libraryStatus(docs[2]).label, "예전 업로드");
  const staged = new Set([
    "custom-documents/b1.json",
    "custom-documents/b2.json",
  ]);
  assert.equal(libraryStatus(docs[1], staged).label, "등록 대기");
  assert.equal(
    libraryStatus(docs[1], new Set(), new Set(["custom-documents/b1.json"]))
      .label,
    "처리 중"
  );
});

test("방금 올린 문서를 미리 고르고, 고른 문서의 쪽 파일을 한 번에 등록 목록에 올림", () => {
  assert.deepEqual(uploadedKeys(docs, ["custom-documents/b2.json"]), ["b"]);
  const files = filesToStage(
    docs,
    new Set(["b"]),
    new Set(["custom-documents/b1.json"])
  );
  assert.deepEqual(
    files.map((f) => f.name),
    ["b2.json"]
  );
});

test("왼쪽 목록에 더 보기·폴더·쪽 줄이 없고 원문 보기가 연결됨", () => {
  const src = readFileSync(new URL("./index.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Load more|FolderRow|FileRow|onLoadMore/);
  assert.match(src, /Workspace\.documentLibrary\(workspace\.slug\)/);
  assert.match(src, /<OriginalPdfModal/);
  const row = readFileSync(
    new URL("../WorkspaceDirectory/OriginalPdfRow/index.jsx", import.meta.url),
    "utf8"
  );
  assert.match(row, /원본 PDF 보기/);
  assert.match(row, /저장 전/);
});
