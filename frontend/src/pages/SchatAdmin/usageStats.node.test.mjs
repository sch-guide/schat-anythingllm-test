import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./sections/UsageStats.jsx", import.meta.url),
  "utf8"
);

test("usage statistics offer the four periods and six cards (AI 사용량 카드 없음)", () => {
  for (const label of ["오늘", "최근 7일", "최근 30일", "최근 90일"])
    assert.match(source, new RegExp(label));
  for (const title of [
    "질문 수",
    "많이 검색된 주제",
    "많이 인용된 지침 문서",
    "한 번도 인용되지 않은 문서",
    "검색 실패 질문",
    "근거 없음 응답",
    "부서별 사용량",
  ])
    assert.match(source, new RegExp(title));
  assert.doesNotMatch(source, /대략적인 AI 사용량/);
  assert.match(source, /인원이 적어 표시하지 않음/);
});

test("usage statistics never show who asked", () => {
  assert.doesNotMatch(
    source,
    /username|employee_number|display_name|user_id|사번|작성자 이름/
  );
  assert.doesNotMatch(source, /1등|꼴찌|순위/);
});

test("검색 실패 카드는 바뀐 집계 기준을 작게 표시함", () => {
  assert.match(source, /data-testid="search-failure-basis"/);
  assert.match(source, /실제로 답을 찾지 못한 경우만/);
  assert.match(source, /예전 기준\(인용된 근거 0건\)/);
});
