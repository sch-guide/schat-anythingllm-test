import test from "node:test";
import assert from "node:assert/strict";

let relatedImagesModule = {};
try {
  relatedImagesModule = await import("./schatRelatedImages.js");
} catch {}

test("related image presentation removes duplicates and caps display at three", () => {
  const key = (letter) => letter.repeat(64);
  const model = relatedImagesModule.buildRelatedImagesModel([
    { imageKey: key("a"), documentName: "A.pdf", page: 1, section: "절차", matchType: "image_description" },
    { imageKey: key("a"), documentName: "A.pdf", page: 1, section: "절차", matchType: "image_description" },
    { imageKey: key("b"), documentName: "A.pdf", page: 2, section: "검사", matchType: "image_description" },
    { imageKey: key("c"), documentName: "A.pdf", page: 3, section: "확인", matchType: "image_description" },
    { imageKey: key("d"), documentName: "A.pdf", page: 4, section: "완료", matchType: "image_description" },
  ]);

  assert.equal(model.length, 3);
  assert.deepEqual(model[0], {
    imageKey: key("a"),
    label: "A.pdf · 절차",
    alt: "A.pdf 절차 관련 이미지",
  });
});

test("missing or invalid image metadata keeps the old answer layout", () => {
  assert.deepEqual(relatedImagesModule.buildRelatedImagesModel(undefined), []);
  assert.deepEqual(
    relatedImagesModule.buildRelatedImagesModel([{ imageKey: "internal-id" }]),
    []
  );
});

test("legacy page-wide related images are hidden because their relevance was not verified", () => {
  assert.deepEqual(
    relatedImagesModule.buildRelatedImagesModel([
      {
        imageKey: "a".repeat(64),
        documentName: "간호실무지침.pdf",
        page: 100,
        section: "통증 사정과 중재 예시",
      },
    ]),
    []
  );
});

test("a directly linked source-unit image is renderable", () => {
  const model = relatedImagesModule.buildRelatedImagesModel([
    {
      imageKey: "f".repeat(64),
      documentName: "guide.pdf",
      page: 100,
      section: "pain assessment",
      matchType: "source_unit",
    },
  ]);

  assert.equal(model.length, 1);
  assert.equal(model[0].imageKey, "f".repeat(64));
});
