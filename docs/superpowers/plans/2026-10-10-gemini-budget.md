# Gemini 상태 저장·채팅 예산 추정 구현 계획

**Goal:** 기존 오류 감시기를 보완하고 채팅 토큰 기준 예산 추정치를 별도 제공함.
**Architecture:** 기존 system_settings에 상태/설정을 저장함. workspace_chats는 읽기만 함. migration/실제 API 호출/commit/push/tag 없음.
**Spec:** 사용자 승인(2026-10-10): 채팅 입력·출력 토큰만 포함, 제외 항목 안내, 80/95% 경고, 계산 정보 부족 시 계산 불가, 재시작 상태 유지.

## 실행 결과

아래 단계의 로컬 구현과 자동검증을 완료함. 서버·유틸 44개, 화면 6개, 문서 분리 11개 검사 및 production build를 통과함. 코드 검토에서 발견한 미측정 토큰·상태 복원 문제는 회귀 테스트를 추가하여 수정함. 실제 브라우저와 Docker 재시작은 미검증이며 Docker/운영 배포는 수행하지 않음. 자세한 결과는 `docs/01_작업일지/2026-10-10_Gemini_상태저장과_채팅예산_추정.md`에 기록함.

- [ ] `geminiAvailability.node.test.js`: 장기 quota/단기 제한/재시작/최초 시각/복구/저장 실패 테스트를 먼저 실패 확인함.
- [ ] `geminiAvailability.js`: 기존 감시기에 설정 저장 어댑터를 추가함. 상태 저장을 직렬화하고 요청/스트림 인자는 그대로 유지함.
- [ ] `geminiSettings.js`: 기존 Prisma system_settings와 정제된 EventLogs만 사용함. 키/원문/질문은 기록하지 않음.
- [ ] `geminiBudget.node.test.js`: 79/80/95%, 토큰/단가 누락, 잘못된 값, 한국 월 경계를 검증함.
- [ ] `geminiBudget.js`: 월 채팅 metrics와 모델별 원화 입력/출력 100만 토큰 단가로 계산함. 정보가 부족하면 null 결과를 반환함.
- [ ] `geminiAvailability.js` endpoint: 관리자 GET와 예산 설정 PUT만 제공함. 권한/입력 검증 테스트함.
- [ ] 기존 배너와 새 `GeminiBudgetPanel.jsx`: 실제 한도와 예산을 분리 표시함. 시스템 상태에 설정 UI를 연결함. SSR로 경고/계산 불가를 검증함.
- [ ] 직원 오류 helper 문구를 갱신함. 기존 검색·체크리스트·퀴즈·문서 처리 코드는 수정하지 않음.
- [ ] 관련 테스트·production build·diff 검사 후 현재 상태/작업일지/문서 화면을 갱신함. 검증하지 못한 것은 그대로 보고함.
