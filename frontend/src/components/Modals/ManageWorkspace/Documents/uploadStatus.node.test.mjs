import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  groupEmbeddingProgress,
  pageInfo,
  uploadFailureText,
} from "./uploadStatus.js";

const id = (n) => `${String(n).padStart(8, "0")}-aaaa-bbbb-cccc-dddddddddddd`;
const page = (name, n) => `custom-documents/${name}-page-${n}-${id(n)}.json`;

test("쪽별 내부 파일을 문서 단위로 묶고 한글 원래 이름으로 보여줌", () => {
  const progress = {
    [page("(260306).pdf", 1)]: { status: "complete" },
    [page("(260306).pdf", 2)]: {
      status: "embedding",
      chunksProcessed: 1,
      totalChunks: 2,
    },
    [page("(260306).pdf", 3)]: { status: "pending" },
    // 다른 문서인데 한글이 빠져 내부 이름이 같은 경우
    [page("(260306).pdf", 4)]: { status: "complete" },
  };
  const meta = {
    [page("(260306).pdf", 1)]: { title: "수술(260306).pdf", documentId: "A" },
    [page("(260306).pdf", 2)]: { title: "수술(260306).pdf", documentId: "A" },
    [page("(260306).pdf", 3)]: { title: "수술(260306).pdf", documentId: "A" },
    [page("(260306).pdf", 4)]: {
      title: "검사 및 시술(260306).pdf",
      documentId: "B",
    },
  };
  const docs = groupEmbeddingProgress(progress, meta);
  assert.deepEqual(
    docs.map((d) => [d.name, d.label, d.total]),
    [
      ["수술(260306).pdf", "처리 중", 3],
      ["검사 및 시술(260306).pdf", "완료", 1],
    ]
  );
  assert.equal(docs[0].percent, 50);
  assert.deepEqual(
    docs[0].items.map((i) => i.page),
    [1, 2, 3]
  );
  assert.deepEqual(docs[0].removable, []);
});

test("대기·실패 한글 상태와 이름을 모를 때 내부 이름으로 묶기", () => {
  const docs = groupEmbeddingProgress({
    [page("guide.pdf", 1)]: { status: "pending" },
    [page("guide.pdf", 2)]: { status: "pending" },
    [page("bad.pdf", 1)]: { status: "failed" },
  });
  assert.deepEqual(
    docs.map((d) => [d.name, d.label]),
    [
      ["guide.pdf", "대기 중"],
      ["bad.pdf", "실패"],
    ]
  );
  assert.equal(docs[0].removable.length, 2);
  assert.deepEqual(pageInfo(page("guide.pdf", 12)), {
    key: "guide.pdf",
    page: 12,
  });
});

test("업로드 오류는 쉬운 문구와 간단한 원인만 보여줌", () => {
  assert.equal(
    uploadFailureText("file-invalid-type"),
    "문서 처리에 실패했습니다. (지원하지 않는 파일)"
  );
  assert.equal(
    uploadFailureText("No text content found in x.pdf."),
    "문서 처리에 실패했습니다. (PDF 읽기 실패)"
  );
  assert.equal(
    uploadFailureText(
      "Document processing API is not online. Document x will not be processed automatically."
    ),
    "문서 처리에 실패했습니다. (문서 처리기 연결 안 됨)"
  );
  assert.equal(
    uploadFailureText("The document upload could not be completed."),
    "문서 처리에 실패했습니다. (처리 중 오류)"
  );
  assert.equal(
    uploadFailureText(undefined),
    "문서 처리에 실패했습니다. (처리 중 오류)"
  );
});

test("새 폴더 버튼·창이 없고 PDF만 받으며 영어 상태 문구가 남지 않음", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const directory = read("./Directory/index.jsx");
  assert.doesNotMatch(directory, /NewFolderModal|openFolderModal|new-folder/);
  assert.equal(
    existsSync(
      new URL("./Directory/NewFolderModal/index.jsx", import.meta.url)
    ),
    false
  );
  const upload = read("./UploadFile/index.jsx");
  assert.match(upload, /accept: PDF_ACCEPT/);
  assert.match(upload, /PDF 파일만 등록할 수 있어요/);
  const right = read("./WorkspaceDirectory/index.jsx");
  assert.doesNotMatch(
    right,
    /"Queued"|"Complete"|"Embedding"|"Failed"|Add to queue|ready to embed/
  );
  assert.match(right, /SCHAT 문서 처리/);
  assert.match(right, /쪽별 상세/);
  const queue = read("./hooks/useUploadQueue.js");
  assert.match(queue, /isPdfFile\(file\)/);
  const ko = readFileSync(
    new URL("../../../../locales/ko/common.js", import.meta.url),
    "utf8"
  );
  assert.match(ko, /"my-documents": "등록할 문서"/);
  assert.match(
    ko,
    /클릭하여 PDF를 업로드하거나 파일을 이곳으로 끌어다 놓으세요\./
  );
});

test("문서를 빼는 중·고정·감시 안내가 한글로 나옴", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const panel = read("./WorkspaceDirectory/index.jsx");
  const row = read("./WorkspaceDirectory/WorkspaceFileRow/index.jsx");
  assert.match(panel, /선택한 문서를 등록 목록에서 빼는 중입니다/);
  assert.match(row, /문서를 등록 목록에서 빼는 중입니다/);
  for (const english of [/Removing (selected )?files? from workspace/, /Pin to workspace/, /Remove document from workspace/, /will be watched for changes/])
    assert.doesNotMatch(panel + row, english);
});
