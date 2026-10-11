# 동의어 B·C·D 실행 계획

목표: 사용자 승인 지시문대로 출처를 줄이고 실행 실패 안내와 분류를 정리한다.
설계 기준: 이번 대화의 B·C·D 지시문. React 화면과 기존 Prisma JSON 기록을 사용하며 DB 구조 변경·실제 Gemini 호출·push는 하지 않는다.

- [ ] B: Synonyms.jsx의 Sources를 검토 대기 칩 뒤로 이동. 별도 출처 열 제거, 검은 설명 상자와 기존 PDF 보기 연결. synonymRendering 검사에서 사용 중 출처 없음과 검토 대기 원문 링크를 검증. synonymTable.css의 열 너비·휴대폰 배치를 조정. 별도 커밋.
- [ ] C: 과거 기록은 실패 쪽 번호와 성공한 묶음이 저장되지 않음. 과거 기록 재시도 불가 안내 여부를 사용자에게 질문한 상태. 답변 전 해당 항목은 보류. 승인 후 기존 documents JSON 안에 처리 범위를 보관하고 서버에서 실패 대상만 고르는 재시도 경로와 관리자 알림을 구현·검사.
- [ ] D: 검색은 getActiveGroups에서 id·terms만 사용하고 kind는 사용하지 않음을 확인. 내부 drug/procedure는 보존하고 화면 이름을 약물/용어로 매핑. 후보 분류 enum도 약물/용어로 제한. DB 백업 후 분류값별 개수를 조회하고 이미 두 값이면 불필요한 DB 쓰기 없이 0개 변경으로 기록. 예외값이 있으면 승인된 매핑에 따라 변경.
- [ ] 가짜 자료 검사 → 기능별 커밋 → 3001 백업 검증 → 이미지 빌드·반영 → PC·휴대폰 가짜 API 화면 확인 → 작업일지·현재 상태·문서 화면 갱신.

확인 명령: Node --test frontend/src/pages/SchatAdmin/synonymRendering.node.test.mjs 및 server/__tests__/utils/synonyms/*.node.test.js. 실제 자료는 화면 검사에 사용하지 않는다. 다른 미커밋 파일은 보존한다.
