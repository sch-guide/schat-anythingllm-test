const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectRelatedImages,
} = require("../../../utils/schatSafety/relatedImages");

test("public related images are deduplicated, capped at three, and contain no internal fields", () => {
  const keys = ["a", "b", "c", "d"].map((value) => value.repeat(64));
  const images = collectRelatedImages([
    {
      document_name: "병원지침.pdf",
      page: 117,
      section: "수혈 절차",
      image_key: keys[0],
      document_id: "must-not-leak",
      image_path: "C:\\internal\\file.png",
    },
    {
      document_name: "병원지침.pdf",
      page: 118,
      section: "수혈 전 검사",
      image_key: keys[0],
    },
    {
      document_name: "병원지침.pdf",
      page: 119,
      section: "수혈 직전 확인",
      image_key: keys[1],
    },
    {
      document_name: "병원지침.pdf",
      page: 120,
      section: "수혈 후 확인",
      image_key: keys[2],
    },
    {
      document_name: "병원지침.pdf",
      page: 121,
      section: "다른 절차",
      image_key: keys[3],
    },
  ]);

  assert.equal(images.length, 3);
  assert.deepEqual(images[0], {
    imageKey: keys[0],
    documentName: "병원지침.pdf",
    page: 117,
    section: "수혈 절차",
    matchType: "image_description",
  });
  assert.equal(JSON.stringify(images).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(images).includes("internal"), false);
});

test("page-level image keys are not published without a matched image-description source", () => {
  const logoKey = "a".repeat(64);
  const unrelatedTableKey = "b".repeat(64);

  assert.deepEqual(
    collectRelatedImages([
      {
        document_name: "간호실무지침.pdf",
        page: 100,
        section: "통증 사정과 중재 예시",
        related_image_keys: JSON.stringify([logoKey, unrelatedTableKey]),
        text: "NRS, FPRS, FLACC",
      },
    ]),
    []
  );
});

test("legacy sources without image metadata remain valid", () => {
  assert.deepEqual(
    collectRelatedImages([{ document_name: "기존문서.pdf", page: 1 }]),
    []
  );
});
