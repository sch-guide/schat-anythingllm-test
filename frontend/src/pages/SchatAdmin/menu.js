// The only admin menu SCHAT shows. Text size and dark mode live in the chat
// screen's top-right display menu, so they are intentionally not listed here.
export const SCHAT_ADMIN_TITLE = "SCHAT 관리자 설정";

export const SCHAT_ADMIN_SECTIONS = [
  {
    key: "brand",
    label: "브랜드 관리",
    description:
      "서비스 이름, 작업 공간 이름과 로그인 화면 브랜드를 관리합니다.",
  },
  {
    key: "answer",
    label: "답변 설정",
    description:
      "답변에 사용하는 AI 모델, 이전 대화 참고 수와 기본 답변 규칙을 관리합니다.",
  },
  {
    key: "answer-cache",
    label: "답변 재사용",
    description:
      "같은 작업 공간의 안전한 독립 질문에 쓰는 답변 저장본과 아낀 답변 호출 수를 확인하고 정리합니다.",
  },
  {
    key: "users",
    label: "사용자 관리",
    description:
      "직원 개인계정(부서·사번·이름)을 추가·일괄등록하고 부서, 권한, 사용 상태와 비밀번호를 관리합니다.",
  },
  {
    // 2026-10-17 '사용 통계'와 '답변 근거 보기'를 합침(예전 주소 usage도 여기로).
    key: "chunks",
    label: "질문·답변 기록",
    description:
      "직원 질문의 통계를 보고, 질문별로 직원이 본 답변과 질문한 직원의 부서·사번을 확인합니다."
  },
  {
    key: "reports",
    label: "문제 신고",
    description: "직원이 보낸 문제 신고를 처리하고 통계와 FAQ를 관리합니다.",
  },
  {
    key: "quiz",
    label: "퀴즈 관리",
    description:
      "지침서 근거로 AI 퀴즈 문제를 만들고, 검토·수정·공개하며 풀이 통계를 확인합니다.",
  },
  {
    key: "guideline-library",
    label: "지침서 원본 자료",
    description:
      "직원 메뉴 '지침서 원본 보기'에 보일 PDF를 올리고 관리합니다. 챗봇 답변에는 쓰이지 않고, 챗봇용 문서는 원본 보기에 나오지 않습니다.",
  },
  {
    key: "checklists",
    label: "체크리스트 관리",
    description:
      "검사·시술 체크리스트를 원문 쪽과 비교해 검토하고, 공개·숨김 상태와 내용을 관리합니다.",
  },
  {
    key: "synonyms",
    label: "동의어 관리",
    description: "같은 뜻의 말을 묶어 두면, 어떤 말로 물어도 지침을 잘 찾아요.",
  },
  {
    key: "status",
    label: "시스템 상태",
    description: "등록 문서, 체크리스트, 검색 데이터와 연결 상태를 확인합니다.",
  },
];

export function findSchatAdminSection(key) {
  if (key === "connections") key = "status";
  // 저장공간 정리 메뉴는 없앰: 예전 주소는 현재 사용 중 요약이 있는 답변 근거 보기로.
  if (key === "storage") key = "chunks";
  // 사용 통계는 질문·답변 기록의 [통계] 탭으로 합침.
  if (key === "usage") key = "chunks";
  return (
    SCHAT_ADMIN_SECTIONS.find((section) => section.key === key) ||
    SCHAT_ADMIN_SECTIONS[0]
  );
}
