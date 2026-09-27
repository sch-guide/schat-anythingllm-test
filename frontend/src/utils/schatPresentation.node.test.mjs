import test from "node:test";
import assert from "node:assert/strict";

let presentationModule = {};
try {
  presentationModule = await import("./schatPresentation.js");
} catch {}

const presentation = {
  kind: "procedure",
  summary: "수혈은 확인 순서에 따라 진행합니다.",
  sections: [
    {
      title: "처방 확인",
      items: [
        { text: "혈액 종류를 확인합니다.", sourceIndexes: [1] },
        { text: "필요한 검사를 처방합니다.", sourceIndexes: [1, 2] },
      ],
    },
    {
      title: "수혈 직전 확인",
      items: [{ text: "환자명을 확인합니다.", sourceIndexes: [2] }],
    },
  ],
};

const sources = [
  { title: "수혈지침 · p.117", excerpt: "첫 번째 근거" },
  { title: "수혈지침 · p.124", excerpt: "두 번째 근거" },
];

test("procedure presentation builds multiple sections, bullets, and source badges", () => {
  assert.equal(
    typeof presentationModule.buildProcedurePresentationModel,
    "function"
  );
  const model = presentationModule.buildProcedurePresentationModel(
    presentation,
    sources
  );

  assert.equal(model.summary, "수혈은 확인 순서에 따라 진행합니다.");
  assert.equal(model.sections.length, 2);
  assert.deepEqual(model.sections[0].items[1], {
    text: "필요한 검사를 처방합니다.",
    badges: [
      { index: 1, title: "수혈지침 · p.117", source: sources[0] },
      { index: 2, title: "수혈지침 · p.124", source: sources[1] },
    ],
  });
  assert.equal(model.sections[0].items[1].badges[0].source.excerpt, "첫 번째 근거");
  assert.equal(model.sections[0].items[1].badges[1].source.excerpt, "두 번째 근거");
});

test("plain or malformed presentation falls back to the existing renderer", () => {
  assert.equal(
    presentationModule.buildProcedurePresentationModel(undefined, sources),
    null
  );
  assert.equal(
    presentationModule.buildProcedurePresentationModel(
      { kind: "procedure", summary: "요약", sections: [] },
      sources
    ),
    null
  );
});

test("procedure layout is full width on mobile and capped near 780px on desktop", () => {
  assert.match(presentationModule.PROCEDURE_LAYOUT_CLASSES, /w-full/);
  assert.match(
    presentationModule.PROCEDURE_LAYOUT_CLASSES,
    /max-w-\[780px\]/
  );
  assert.match(presentationModule.PROCEDURE_LAYOUT_CLASSES, /leading-\[1\.7\]/);
});
