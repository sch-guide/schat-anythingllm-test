# 동시 답변 제한 구현 계획

**Goal:** 승인된 4건 처리·10건 대기·30초 대기·120초 생성 제한을 일반/Agent 경로에 공통 적용함.
**Architecture:** 단일 프로세스 공통 제어기, 사용자 ID 기준 점유, 취소 신호와 단 한 번의 자리 반환. 기존 SystemSettings로 관리자 설정 보관.
**Tech Stack:** Node.js, Express/SSE/WebSocket, React, node:test.
**Spec:** 사용자 승인 및 `docs/01_작업일지/2026-10-10_동시답변_제한_구현진행.md`.

## 제약

현재 폴더에서 기존 변경 보존. 실제 Gemini 호출·DB migration·검색 비율/프롬프트 변경 금지. 기능 완료 후 이번 변경만 commit, push 금지. 단계별 부분 코드를 실행 경로에 불완전하게 연결하지 않음.

## 1. 독립 제어기

- [ ] `server/__tests__/utils/chatAdmission.node.test.js`: 4개 입장·5번째 대기, 사용자 중복, FIFO, 대기 30초, 생성 120초, AbortSignal, 중복 해제, 설정 감소를 테스트함.
- [x] `node --test server/__tests__/utils/chatAdmission.node.test.js`로 모듈 부재 실패 확인.
- [ ] `server/utils/chatAdmission.js`: `createAdmission()`이 `acquire(userId,{signal,onPosition})`, `snapshot()`, `configure({maxActive})`를 제공함. 반환 lease는 `signal`, `release()`를 제공함. 테스트에서 외부 API 대신 가짜 시계를 주입함.
- [x] 최종 독립 모듈 테스트 12개 통과 확인. 이 단계만으로 기능 완료 처리하지 않음. 나머지 실제 연결 단계는 미완료임.

## 2. 실제 실행 경로 연결

- [ ] `server/endpoints/chat.js`, `server/utils/chats/agents.js`, `server/endpoints/agentWebsocket.js`의 일반/Agent 전환을 함께 연결함.
- [ ] Agent로 넘어갈 때 HTTP 종료가 자리 반환을 일으키지 않도록 일회용 invocation 연결을 관리함. 미접속·중복 WebSocket·연결 종료 테스트부터 추가함.
- [ ] `server/utils/helpers/abortSignals.js`의 기존 취소 전달을 재사용하되, 검색 중 취소 뒤 늦게 생성이 시작되지 않도록 취소 상태를 검사함. 숫자만 줄이고 실제 호출을 남기는 구현은 금지함.
- [ ] 직접 요청·여러 탭·스레드 변경이 사용자 ID 제한을 우회하지 않는지 통합 테스트함.

## 3. 설정과 화면

- [ ] 기존 관리자 역할 검사를 사용하는 전용 설정/현황 API 추가. 권한 거절·범위 검사·저장 실패 테스트함.
- [ ] 관리자 시스템 상태에 제한 설정과 현재 처리/대기 수를 표시함. 직원에게 대기 순번을 SSE/WebSocket 상태로 전달하며 Gemini 혼잡과 구분함.
- [ ] 설정 재시작 유지, 처리 수 미복원, 한도 감소 중 기존 답변 유지 테스트함.

## 4. 완료 검증

- [ ] 종료·오류·시간 초과 이후 새 요청 입장 가능 테스트, 기존 채팅 회귀, frontend build.
- [ ] 현재 상태·작업일지 갱신 및 문서 화면 재생성·검사.
- [ ] 변경별 diff 확인. 기존 타 작업과 섞인 파일은 이번 hunk만 stage. 저장 데이터·비밀값 제외 확인 후 별도 commit. push하지 않음.

## 이어서 구현한 결과

위 체크 목록은 최초 계획의 기록임. 실제 연결은 HTTP에서 Agent로 자리를 넘기는 방식 대신, 일반 HTTP는 grepAgents 뒤 입장하고 Agent는 WebSocket 연결 후 입장하는 방식으로 단순화함. 미접속 연결은 자리를 점유하지 않으며 같은 invocation의 동시 중복 연결을 거절함.

공통 대기열, 연결 종료/기한 취소, 요청별 Gemini 임베딩 취소, 직원 순번, 관리자 설정 저장/현황을 구현함. 관련 신규·회귀 46개 테스트와 Vite build/postbuild를 검증함. 실제 브라우저 및 부하 테스트는 별도 확인 대상임. 상세 현재 결과와 제한은 `docs/01_작업일지/2026-10-10_동시답변_제한_구현진행.md`를 기준으로 함.
