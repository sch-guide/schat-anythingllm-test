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
    key: "users",
    label: "사용자 관리",
    description:
      "직원 개인계정(부서·사번·이름)을 추가·일괄등록하고 부서, 권한, 사용 상태와 비밀번호를 관리합니다.",
  },
  {
    key: "reports",
    label: "문제 신고",
    description: "직원이 보낸 문제 신고를 처리하고 통계와 FAQ를 관리합니다.",
  },
  {
    key: "connections",
    label: "시스템 연결",
    description: "AI 답변과 문서 검색에 쓰는 API 키를 확인하고 교체합니다.",
  },
  {
    key: "status",
    label: "시스템 상태",
    description: "등록 문서, 체크리스트, 검색 데이터와 연결 상태를 확인합니다.",
  },
  {
    key: "storage",
    label: "저장공간 정리",
    description:
      "예전 업로드로 남은 페이지 기록과 이미지를 확인합니다. 현재 사용 중인 자료는 보호됩니다.",
  },
  {
    key: "danger",
    label: "위험 설정",
    description: "되돌릴 수 없는 작업입니다. 신중하게 사용하세요.",
  },
];

export function findSchatAdminSection(key) {
  return (
    SCHAT_ADMIN_SECTIONS.find((section) => section.key === key) ||
    SCHAT_ADMIN_SECTIONS[0]
  );
}
