// 2026-11-09: 운영 새 판에서 띄어쓰기·줄바꿈만 다른 체크리스트가 "changed"(검토 필요)로 걸렸다.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  matchPreviousVersion,
  contentFingerprint,
  looseFingerprint,
} = require("../../../utils/documentChecklists/versionMatch");

const make = (id, documentId, details, extra = {}) => {
  const checklist = {
    id,
    documentId,
    title: "가상검사 ABCD",
    aliases: ["ABCD"],
    source: { filename: `검사 및 시술(${documentId}).pdf` },
    sections: [
      {
        title: "검사 전",
        items: [{ type: "checkable", label: "검사목적", details }],
      },
    ],
    status: "active",
    active: true,
    ...extra,
  };
  return { ...checklist, sourceFingerprint: contentFingerprint(checklist) };
};

test("띄어쓰기·줄바꿈만 다르면 같은 것으로 보고 다시 공개한다", () => {
  const old = make("old", "v1", ["질병이 발생한폐의 부위로 접근", "IV 18G+3way"]);
  for (const details of [
    ["질병이 발생한 폐의 부위로 접근", "IV 18G + 3way"],
    ["질병이 발생한 폐의", "부위로 접근 IV 18G + 3way"], // 줄이 다르게 나뉨
  ]) {
    const next = make("new", "v2", details, { status: "needs_review" });
    assert.equal(matchPreviousVersion(next, [old]).result, "same", details.join("|"));
  }
});

test("글자·숫자가 하나라도 다르면 지금처럼 검토로 남긴다", () => {
  const old = make("old", "v1", ["1 조영제 사용 동의서"]);
  for (const details of [["1 CT 검사 동의서"], ["1 조영제 사용 동의서", "2 CCTV 모니터링 동의서"], ["2 조영제 사용 동의서"]]) {
    const next = make("new", "v2", details, { status: "needs_review" });
    assert.equal(matchPreviousVersion(next, [old]).result, "changed", details.join("|"));
  }
});

test("관리자가 고친 예전 것은 저장된 원본 지문(띄어쓰기 무시)으로만 비교한다", () => {
  const source = make("old", "v1", ["질병이 발생한폐"]);
  const edited = {
    ...source,
    sections: [{ title: "검사 전", items: [{ type: "checkable", label: "검사목적", details: ["관리자가 고친 글"] }] }],
    editedByAdmin: true,
    sourceFingerprint: undefined, // 이 기능 전에 고친 예전 파일
  };
  const next = make("new", "v2", ["질병이 발생한 폐"], { status: "needs_review" });
  // 지문 없이 고친 예전 것: 비교할 수 없음
  assert.equal(matchPreviousVersion(next, [edited]).result, "previous-unverifiable");
  // 원본 지문을 저장해 둔 경우(앞으로 올리는 것): 같은 원본이면 다시 공개
  const withLoose = { ...edited, sourceLooseFingerprint: looseFingerprint(source) };
  assert.equal(matchPreviousVersion(next, [withLoose]).result, "same");
});
