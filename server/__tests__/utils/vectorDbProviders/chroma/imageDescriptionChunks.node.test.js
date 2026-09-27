const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildImageDescriptionChunks,
} = require("../../../../utils/vectorDbProviders/chroma/imageDescriptionChunks");

test("image descriptions become auxiliary chunks without changing body chunks", () => {
  const bodyChunks = ["병원 지침의 기존 본문 문장"];
  const result = buildImageDescriptionChunks({
    images: [
      {
        image_key: "a".repeat(64),
        description: "중심정맥관 연결 순서를 보여주는 절차도",
      },
      { image_key: "b".repeat(64), description: "" },
    ],
    metadata: { page: 117, section: "수혈 절차" },
  });

  assert.deepEqual(bodyChunks, ["병원 지침의 기존 본문 문장"]);
  assert.deepEqual(result, [
    {
      text: "중심정맥관 연결 순서를 보여주는 절차도",
      metadata: {
        page: 117,
        section: "수혈 절차",
        content_type: "image_description",
        image_key: "a".repeat(64),
      },
    },
  ]);
});
