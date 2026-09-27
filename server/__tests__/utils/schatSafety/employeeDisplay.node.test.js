const test = require("node:test");
const assert = require("node:assert/strict");

const {
  finalizeSafetyDecision,
  formatValidatedAnswer,
  sanitizeEmployeeAnswer,
} = require("../../../utils/schatSafety/finalize");

test("직원 답변에서 내부 metadata와 SVG placeholder를 제거한다", () => {
  const cleaned = sanitizeEmployeeAnswer(
    "<document_metadata>internal</document_metadata>\n[svg]\n관련 원문 문장"
  );

  assert.equal(cleaned, "관련 원문 문장");
});

test("닫히지 않은 내부 metadata와 SVG 코드도 직원에게 노출하지 않는다", () => {
  assert.equal(
    sanitizeEmployeeAnswer("안전 답변\n<svg><path d='internal'>"),
    "안전 답변"
  );
  assert.equal(
    sanitizeEmployeeAnswer("안전 답변\n<document_metadata>internal-id"),
    "안전 답변"
  );
});

test("정상 Markdown 이미지는 제거하지 않고 렌더링 입력으로 보존한다", () => {
  const markdown = "장비 화면\n\n![장비](https://example.test/device.png)";
  assert.equal(sanitizeEmployeeAnswer(markdown), markdown);
});

test("안전 실패 fallback도 직원 표시 전에 정리한다", () => {
  const result = finalizeSafetyDecision({
    prepared: {
      fallback: {
        text: "<svg><text>internal</text></svg>\nsvg\n원문 근거",
        sources: [{ document_name: "지침.pdf", section: "대상" }],
      },
    },
    validation: { decision: "FAIL", error_code: "evidence_coverage" },
  });

  assert.equal(result.text, "원문 근거");
  assert.equal(result.safety.usedFallback, true);
});

test("종류형 통과 답변은 문장 내용을 바꾸지 않고 목록으로 표시한다", () => {
  const text = "적혈구 제제가 있습니다.\n\n혈소판 제제가 있습니다.";

  assert.equal(
    formatValidatedAnswer(text, "list"),
    "- 적혈구 제제가 있습니다.\n- 혈소판 제제가 있습니다."
  );
});

test("절차형 통과 답변은 원래 순서를 유지해 번호로 표시한다", () => {
  const text = "환자를 확인합니다.\n\n활력징후를 측정합니다.";

  assert.equal(
    formatValidatedAnswer(text, "numbered_steps"),
    "1. 환자를 확인합니다.\n2. 활력징후를 측정합니다."
  );
});

test("안전검사를 통과한 단계명과 설명은 번호·소제목으로 표시한다", () => {
  const text =
    "처방 및 동의 확인: 의사는 수혈 처방을 확인하고 동의서를 작성합니다.\n\n시행 전 확인: 환자와 혈액을 확인합니다.";

  assert.equal(
    formatValidatedAnswer(text, "numbered_steps"),
    "1. **처방 및 동의 확인**\n   의사는 수혈 처방을 확인하고 동의서를 작성합니다.\n2. **시행 전 확인**\n   환자와 혈액을 확인합니다."
  );
});

test("후보에 이미 들어간 표시용 번호나 목록 기호는 중복 표시하지 않는다", () => {
  assert.equal(
    formatValidatedAnswer("1. 환자를 확인합니다.\n\n2. 활력징후를 측정합니다.", "numbered_steps"),
    "1. 환자를 확인합니다.\n2. 활력징후를 측정합니다."
  );
  assert.equal(
    formatValidatedAnswer("- 적혈구 제제\n\n- 혈소판 제제", "list"),
    "- 적혈구 제제\n- 혈소판 제제"
  );
});

test("준비형 통과 답변은 체크리스트로 표시한다", () => {
  const text = "동의서를 확인합니다.\n\n준비물을 확인합니다.";

  assert.equal(
    formatValidatedAnswer(text, "checklist"),
    "- [ ] 동의서를 확인합니다.\n- [ ] 준비물을 확인합니다."
  );
});

test("비교형 통과 답변은 근거 문장별 목록으로 표시한다", () => {
  const text = "A 제제는 10 mg입니다.\n\nB 제제는 20 mg입니다.";

  assert.equal(
    formatValidatedAnswer(text, "comparison"),
    "- A 제제는 10 mg입니다.\n- B 제제는 20 mg입니다."
  );
});

test("설명형 통과 답변은 첫 결론과 핵심 설명을 구분한다", () => {
  const text = "비터널형 카테터의 정의입니다.\n\n등록 지침의 핵심 설명입니다.";

  assert.equal(
    formatValidatedAnswer(text, "explanation"),
    "**핵심 답변**\n\n비터널형 카테터의 정의입니다.\n\n**핵심 설명**\n\n등록 지침의 핵심 설명입니다."
  );
});

test("표현 형식은 안전검사 PASS 답변에만 적용하고 fallback은 바꾸지 않는다", () => {
  const passed = finalizeSafetyDecision({
    prepared: { answer_style: "numbered_steps" },
    validation: {
      decision: "PASS",
      retry_count: 0,
      display_output: {
        kind: "candidate",
        text: "환자를 확인합니다.\n\n활력징후를 측정합니다.",
        sources: [],
      },
    },
  });
  const failed = finalizeSafetyDecision({
    prepared: {
      answer_style: "numbered_steps",
      fallback: { text: "환자를 확인한다.\n\n활력징후를 측정한다.", sources: [] },
    },
    validation: { decision: "FAIL", error_code: "number_changed" },
  });

  assert.equal(
    passed.text,
    "1. 환자를 확인합니다.\n2. 활력징후를 측정합니다."
  );
  assert.equal(failed.text, "환자를 확인한다.\n\n활력징후를 측정한다.");
});
