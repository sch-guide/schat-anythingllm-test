import test from "node:test";
import assert from "node:assert/strict";
import { maskChecklistPatient } from "./checklistPatientMask.js";

// All names below are synthetic examples, never copied from patient records.
for (const [input, expected] of [
  ["612호 / 홍길", "612호 / 홍○"],
  ["612호 / 홍길동", "612호 / 홍○동"],
  ["612호 / 남궁민수", "612호 / 남○○수"],
  ["612호 / 가나다라마", "612호 / 가○○○마"],
  ["612호 홍길동", "612호 홍○동"],
  ["612호홍길동", "612호홍○동"],
  ["홍길동 612호", "홍○동 612호"],
  ["612호 / 홍○동", "612호 / 홍○동"],
  ["612호 / 남○민수", "612호 / 남○○수"],
  ["612호 가나다라마", "612호 가○○○마"],
  ["612호", "612호"],
  ["", ""],
]) {
  test(`synthetic patient masking: ${input}`, () => {
    assert.equal(maskChecklistPatient(input), expected);
    assert.equal(maskChecklistPatient(expected), expected);
  });
}

// 기타메모: 문맥이 있는 이름만 가리고, 간호 용어·약 이름은 그대로 둔다(모두 가짜 문장).
import { maskChecklistOther } from "./checklistPatientMask.js";
for (const [input, expected] of [
  ["612호 홍길동 NPO", "612호 홍○동 NPO"],
  ["612호 / 홍길동 / 금식", "612호 / 홍○동 / 금식"],
  ["612호홍길동 13시 수혈", "612호홍○동 13시 수혈"],
  ["홍길동님 보호자 연락", "홍○동님 보호자 연락"],
  ["홍길동 환자 13시 혈당", "홍○동 환자 13시 혈당"],
  ["홍길동씨 소변량 측정", "홍○동씨 소변량 측정"],
  ["홍길동 보호자 연락 완료", "홍○동 보호자 연락 완료"],
  ["환자: 홍길동 NPO 유지", "환자: 홍○동 NPO 유지"],
  ["이름 남궁민수 수혈 예정", "이름 남○○수 수혈 예정"],
  ["홍길동님께 설명함", "홍○동님께 설명함"],
  // 그대로 두어야 하는 간호 용어·약 이름·호칭
  ["반코 trough 채혈", "반코 trough 채혈"],
  ["낙상 고위험 재평가", "낙상 고위험 재평가"],
  ["612호 수혈 예정", "612호 수혈 예정"],
  ["612호 낙상 고위험", "612호 낙상 고위험"],
  ["고위험 환자 재평가", "고위험 환자 재평가"],
  ["당뇨 환자 인슐린 확인", "당뇨 환자 인슐린 확인"],
  ["중환자실 전동 예정", "중환자실 전동 예정"],
  ["교수님 회진 후 투약", "교수님 회진 후 투약"],
  ["선생님께 보고", "선생님께 보고"],
  ["반코마이신 1g 투여 후 trough", "반코마이신 1g 투여 후 trough"],
  ["헤파린 aPTT 6시간마다", "헤파린 aPTT 6시간마다"],
  ["어머님 보호자 상주", "어머님 보호자 상주"],
  ["홍길동 13시 수혈", "홍길동 13시 수혈"],
  ["", ""],
]) {
  test(`synthetic other-memo masking: ${input || "(빈 칸)"}`, () => {
    assert.equal(maskChecklistOther(input), expected);
    assert.equal(maskChecklistOther(expected), expected);
  });
}
