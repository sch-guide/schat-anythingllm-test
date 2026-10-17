// 2026-10-15: "폐엽절제술", "lobectomy"처럼 원문 수술명 줄에만 있는 이름으로 물어도
// 체크리스트가 뜨게 한다. 가상 글자만 쓴다.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  namesFromNameLine,
  titleAreas,
  namesForPage,
  sourceNamesForChecklists,
  sourceTitlesForChecklists,
} = require("../../../utils/documentChecklists/sourceNames");
const {
  toPublicChecklist,
  isFormTextAlias,
} = require("../../../utils/documentChecklists/presenter");

test("같은 병명 아래 서로 다른 수술명은 직원 체크리스트 제목에서 구분된다", () => {
  const checklists = [
    { id: "one", documentId: "title-test", page: 1, title: "가상암 Alpha cancer", aliases: ["가상암"], status: "active" },
    { id: "two", documentId: "title-test", page: 2, title: "가상암 Alpha cancer", aliases: ["가상암"], status: "active" },
  ];
  const titles = sourceTitlesForChecklists(checklists, [1, 2].map((page) => ({
    docpath: `title-test/${page}.json`, metadata: { document_id: "title-test", page },
  })), {
    documentsPath: path.resolve("/title-test"),
    readFile: (file) => JSON.stringify({ pageContent: [
      "간호교육파트", "가상암 Alpha cancer",
      file.endsWith("1.json") ? "수술명 : 가상부분절제술 (Partialectomy)" : "수술명 : 가상전절제술 (Totalectomy)",
      "설명 문장은 제목에 넣지 않는다", "수 술 전", "동의서",
    ].join("\n") }),
  });
  const shown = checklists.map((checklist) => toPublicChecklist(checklist, {
    sourceTitle: titles.get(checklist.id), hideFormTextAliases: true,
  }));
  assert.deepEqual(shown.map((item) => item.title), [
    "가상부분절제술 (Partialectomy)", "가상전절제술 (Totalectomy)",
  ]);
  assert.equal(toPublicChecklist(checklists[0], { sourceTitle: titles.get("one") }).title, "가상암 Alpha cancer");
  assert.equal(checklists[0].title, "가상암 Alpha cancer");
  assert.equal(toPublicChecklist(checklists[0], { hideFormTextAliases: true }).title, "가상암 Alpha cancer");
});

test("수술명 줄에서 한글·영어 이름을 하나씩 나눈다", () => {
  assert.deepEqual(
    namesFromNameLine("가상엽절제술(Alphaectomy),양엽절제술(Bialphaectomy) / 전절제술(Totalectomy)"),
    ["가상엽절제술", "Alphaectomy", "양엽절제술", "Bialphaectomy", "전절제술", "Totalectomy"]
  );
  // 좌우·or 같은 낱말은 이름에서 뺀다.
  assert.deepEqual(namesFromNameLine("가상봉합술(Rt or Lt Betaplasty)"), ["가상봉합술", "Betaplasty"]);
});

const TWO_FORMS = [
  "업데이트 예정입니다. 연락주십시오.",
  "가상암 Alpha cancer",
  "수술명 : 가상엽절제술(Alphaectomy)",
  "수",
  "술",
  "전",
  "동의서",
  "본문",
  "업데이트 예정입니다. 연락주십시오.",
  "가상결석 Beta stone",
  "수술명 : 가상쇄석술(Lithobeta)",
  "수 술 전",
  "동의서",
].join("\n");

test("한 쪽의 양식마다 제목 부분을 나누고, 제목이 맞는 체크리스트에 이름을 붙인다", () => {
  assert.equal(titleAreas(TWO_FORMS).length, 2);
  const names = namesForPage(TWO_FORMS, [
    { id: "b", title: "가상결석 Beta stone", aliases: ["가상결석"] },
    { id: "a", title: "가상암 Alpha cancer", aliases: ["가상암"] },
  ]);
  assert.deepEqual(names.get("a"), ["가상암", "Alpha cancer", "가상엽절제술", "Alphaectomy"]);
  assert.deepEqual(names.get("b"), ["가상결석", "Beta stone", "가상쇄석술", "Lithobeta"]);
});

test("작업 공간 문서의 쪽 글자로 체크리스트 이름을 찾고, 문서 폴더 밖은 읽지 않는다", () => {
  const root = path.resolve("/virtual-documents");
  const files = { [path.resolve(root, "custom/p3.json")]: JSON.stringify({ pageContent: TWO_FORMS }) };
  const read = [];
  const result = sourceNamesForChecklists(
    [
      { id: "a", documentId: "doc-1", page: 3, title: "가상암 Alpha cancer", aliases: [] },
      { id: "x", documentId: "doc-1", page: 9, title: "다른 쪽", aliases: [] },
    ],
    [
      { docpath: "custom/p3.json", metadata: JSON.stringify({ document_id: "doc-1", page: 3 }) },
      { docpath: "../outside.json", metadata: { document_id: "doc-1", page: 9 } },
    ],
    {
      documentsPath: root,
      readFile: (file) => {
        read.push(file);
        if (!files[file]) throw new Error("missing");
        return files[file];
      },
    }
  );
  assert.deepEqual(result.get("a").slice(-2), ["가상엽절제술", "Alphaectomy"]);
  assert.equal(result.has("x"), false);
  assert.deepEqual(read, [path.resolve(root, "custom/p3.json")]);
});

test("원문 이름은 찾기용 이름에만 더하고, 저장된 이름과 같으면 다시 넣지 않는다", () => {
  const checklist = { id: "a", title: "가상암", aliases: ["가상암"], sections: [], status: "active" };
  const result = toPublicChecklist(checklist, { sourceNames: ["가상암", "가상엽절제술", "Alphaectomy"] });
  assert.deepEqual(result.aliases, ["가상암"]);
  assert.ok(result.searchAliases.includes("가상엽절제술"));
  assert.ok(result.searchAliases.includes("Alphaectomy"));
  assert.ok(!result.searchAliases.includes("가상암"));
});

test("양식 본문 글자로 된 예전 이름은 직원 화면에서만 뺀다", () => {
  const checklist = {
    id: "a",
    title: "가상정맥류",
    aliases: ["가상정맥류", "Varix virtualis", "Prepare", "수술실/S-car", "금식여부 MN NPO", "가상 Lab 시행"],
    sections: [],
    status: "active",
  };
  assert.deepEqual(toPublicChecklist(checklist, { hideFormTextAliases: true }).aliases, [
    "가상정맥류",
    "Varix virtualis",
  ]);
  assert.equal(toPublicChecklist(checklist).aliases.length, 6);
  for (const name of ["서혜부 탈장 봉합술", "Endoscopic Retrograde Cholangiopancreatography", "가상 확인 검사"])
    assert.equal(isFormTextAlias(name), false, name);
});
