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

test("현재 사용 중 문서는 삭제 불가, 예전 문서는 서버 점검이 삭제 가능일 때만", async () => {
  const { deleteState, librarySections, checklistCount } = await import(
    "./documentLibraryView.js"
  );
  const current = { key: "a", status: "registered", cleanupKey: "ka" };
  const old = { key: "c", status: "unregistered", cleanupKey: "kc" };
  const cited = { key: "d", status: "unregistered", cleanupKey: "kd" };
  const groups = new Map([
    ["ka", { status: "in_use", usage: { checklists: 80 } }],
    ["kc", { status: "old_upload", usage: { checklists: 0 } }],
    [
      "kd",
      {
        status: "review",
        reasons: [
          "과거 답변 출처나 퀴즈가 이 문서를 가리키고 있어 삭제하지 않습니다.",
        ],
      },
    ],
  ]);
  assert.deepEqual(deleteState(current, groups, true), {
    deletable: false,
    reason: "현재 사용 중인 문서입니다.",
  });
  assert.equal(deleteState(old, groups, true).deletable, true);
  assert.equal(
    deleteState(old, groups, false).deletable,
    false,
    "관리자만 삭제"
  );
  assert.equal(
    deleteState(old, null, true).deletable,
    false,
    "점검 결과 전에는 삭제 버튼 없음"
  );
  assert.match(
    deleteState(cited, groups, true).reason,
    /과거 답변 출처나 퀴즈/
  );
  assert.equal(
    deleteState({ ...old, cleanupKey: "zz" }, groups, true).deletable,
    false
  );
  assert.equal(checklistCount(current, groups), 80);
  const sections = librarySections([
    current,
    old,
    { key: "p", status: "partial" },
  ]);
  assert.deepEqual(
    sections.current.map((d) => d.key),
    ["a", "p"]
  );
  assert.deepEqual(
    sections.old.map((d) => d.key),
    ["c"]
  );
});

test("과거 답변 출처로만 쓰인 예전 문서는 경고 후 '그래도 삭제'", () => {
  const src = readFileSync(new URL("./index.jsx", import.meta.url), "utf8");
  assert.match(src, /pastAnswers=\{\s*Number\(groups\?\.get\(deleting\.cleanupKey\)\?\.pastAnswerRefs\) \|\| 0\s*\}/);
  assert.match(src, /이 문서는 과거 답변 \{pastAnswers\}건의 출처로 사용되었습니다\./);
  assert.match(src, /삭제하면 해당 과거 답변에서 원본을 다시 열 수 없습니다\./);
  assert.match(src, /pastAnswers > 0 \? "그래도 삭제" : "삭제"/);
});
