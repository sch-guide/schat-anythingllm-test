export function maskChecklistPatient(value) {
  const text = String(value ?? "").normalize("NFC");
  // A room prefix belongs to the room, not the following Korean name.
  return text
    .split(/(\d+호)/u)
    .map((part) => {
      if (/^\d+호$/u.test(part)) return part;
      return part.replace(/[가-힣○]+/gu, (word) => {
        if (word.length < 2) return word;
        return word.length === 2
          ? `${word[0]}○`
          : `${word[0]}${"○".repeat(word.length - 2)}${word.at(-1)}`;
      });
    })
    .join("");
}

// 기타메모: 자유롭게 쓰는 칸이라 모든 한글을 가리면 간호 기록이 읽히지 않는다.
// 이름처럼 보이는 한글 2~4자가 병실 번호 뒤, 님·환자·씨·보호자 앞, 환자:/이름: 뒤에
// 올 때만 가운데 글자를 가린다. 간호 용어·호칭은 아래 목록으로 가리지 않는다.
const NOT_NAMES = new Set([
  "수혈",
  "낙상",
  "고위험",
  "저위험",
  "재평가",
  "금식",
  "채혈",
  "투약",
  "투석",
  "당뇨",
  "격리",
  "신규",
  "응급",
  "소아",
  "노인",
  "고령",
  "퇴원",
  "입원",
  "전동",
  "전원",
  "수술",
  "수술후",
  "시술",
  "검사",
  "중증",
  "경증",
  "와상",
  "치매",
  "섬망",
  "욕창",
  "감염",
  "발열",
  "통증",
  "담당",
  "해당",
  "다른",
  "같은",
  "모든",
  "신환",
  "대상",
  "동반",
  "협진",
  "관찰",
  "확인",
  "예정",
  "완료",
  "오전",
  "오후",
  "내일",
  "오늘",
  "금일",
  "익일",
  "야간",
  "주간",
  "산소",
  "혈압",
  "혈당",
  "체온",
  "소변",
  "배액",
  "처치",
  "항암",
  "수액",
  "주사",
  "경구",
  "상태",
  "이동",
  "침상",
  "병상",
  "보호",
  "간병",
  "간병인",
  "가족",
  "남자",
  "여자",
  "남아",
  "여아",
  "성인",
  "임산부",
  "산모",
  "신생아",
  "이식",
  "투여",
  "측정",
  "교육",
  "설명",
  "동의",
  "선생",
  "교수",
  "주치의",
  "간호사",
  "수간호사",
  "과장",
  "원장",
  "보호자",
  "어머",
  "아버",
  "할머",
  "할아버",
  "아저",
  "아가",
  "본인",
  "해당자",
  "중환",
  "외래",
  "병동",
  "보고",
  "연락",
  "회진",
  "드레싱",
  "안정",
  "절대",
  "이상",
]);
const PARTICLES = "(?:께서|에게|으로|은|는|이|가|을|를|의|께|도|만|과|와|로)*";
const hideName = (word) =>
  NOT_NAMES.has(word)
    ? word
    : word.length === 2
      ? `${word[0]}○`
      : `${word[0]}${"○".repeat(word.length - 2)}${word.at(-1)}`;

export function maskChecklistOther(value) {
  return (
    String(value ?? "")
      .normalize("NFC")
      // 612호 홍길동 / 612호/홍길동 / 612호홍길동
      .replace(
        /(\d+호\s*[/·,]?\s*)([가-힣]{2,4})(?![가-힣])/gu,
        (_, room, word) => room + hideName(word)
      )
      // 홍길동님, 홍길동 환자, 홍길동씨, 홍길동 보호자
      .replace(
        new RegExp(
          String.raw`(?<![가-힣○])([가-힣]{2,4}?)(\s*(?:님|환자|씨|보호자))(?=${PARTICLES}(?:$|[^가-힣]))`,
          "gu"
        ),
        (_, word, suffix) => hideName(word) + suffix
      )
      // 환자: 홍길동 / 성명 홍길동 / 이름: 홍길동
      .replace(
        new RegExp(
          String.raw`(?<![가-힣○])((?:환자|성명|이름)\s*[:：]\s*|(?:성명|이름)\s+)([가-힣]{2,4}?)(?=${PARTICLES}(?:$|[^가-힣]))`,
          "gu"
        ),
        (_, prefix, word) => prefix + hideName(word)
      )
  );
}
