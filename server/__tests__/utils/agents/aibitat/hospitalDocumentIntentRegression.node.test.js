const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldForceHospitalRagSearch,
  buildHospitalRetrievalQuery,
  isolateCurrentHospitalQuestion,
} = require("../../../../utils/agents/aibitat/utils/hospitalDocumentIntent");

test("구어체 수혈 질문과 성인 모니터링 질문을 병원 문서 질문으로 인식한다", () => {
  assert.equal(shouldForceHospitalRagSearch("피 넣기 전에 뭐부터 체크해야 돼?"), true);
  assert.equal(shouldForceHospitalRagSearch("성인은 몇 분마다 모니터링해?"), true);
  assert.equal(shouldForceHospitalRagSearch("오늘 날씨 어때?"), false);
  assert.match(buildHospitalRetrievalQuery("피 넣기 전에 뭐부터 체크해야 돼?", []), /수혈/);
});

test("후속질문은 직전 사용자 질문의 임상 주제만 검색어에 보완한다", () => {
  const history = [
    { role: "user", content: "진정은 어떻게 진행하는 거야?" },
    { role: "assistant", content: "이전 답변" },
    { role: "user", content: "그중 후에는 어떻게 관찰해?" },
  ];
  assert.equal(
    buildHospitalRetrievalQuery("그중 후에는 어떻게 관찰해?", history),
    "진정 그중 후에는 어떻게 관찰해?"
  );
});

test("병원 질문에 근거가 없으면 이전 답변 문맥을 Gemini에 넘기지 않는다", () => {
  const messages = [
    { role: "system", content: "system" },
    { role: "user", content: "이전 질문" },
    { role: "assistant", content: "15분마다 확인하세요" },
    { role: "user", content: "성인은 몇 분마다 모니터링해?" },
  ];
  assert.deepEqual(
    isolateCurrentHospitalQuestion(messages, "성인은 몇 분마다 모니터링해?"),
    [
      { role: "system", content: "system" },
      { role: "user", content: "성인은 몇 분마다 모니터링해?" },
    ]
  );
});
