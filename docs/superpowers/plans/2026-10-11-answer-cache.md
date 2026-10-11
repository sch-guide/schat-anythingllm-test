# 5단계 동일 질문 캐시 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 동일 질문에만 답변과 출처를 재사용하여 실제 Gemini 호출을 줄임.
**Architecture:** 단일 서버 메모리의 전역 최대 100개 LRU 보관소, workspace ID와 문서 세대 번호로 격리함. 재시작하면 비워져 오래된 답변이 복원되지 않음. 초기에는 문맥·첨부·Agent 도구에 의존하는 답변을 재사용하지 않음. 안전한 일반 query 경로부터 연결함.
**Tech Stack:** Node.js, Express/SSE, React, node:test.
**Spec:** 사용자가 승인한 5단계 요구: 띄어쓰기/문장부호/대소문자 차이만 재사용, 전체 100개, 부서별 격리, 문서 변경 무효화, 출처 유지, 대기열/하루 호출 제외, 관리자 조회/삭제/절약 호출 수.

## 공통 제약

- 기존 미커밋 변경 보존, 실제 API 호출·운영 DB·Google Cloud·push 금지.
- 소수점·음수·범위·비율·단위 대소문자는 임의로 합치지 않음. 모호하면 캐시 미적중이 안전함.
- 캐시는 직원간 개인 대화 복사 도구가 아님. 대화 맥락·첨부·사용자별 자료 접근권한을 확인하기 전 실행 경로에 연결하지 않음.
- 캐시 저장 중 문서가 바뀌면 이전 세대 결과는 저장하지 않음. 검색/임베딩 비율과 답변 프롬프트는 변경하지 않음.

## Task 1: 독립 보관소

파일: `server/utils/answerCache.js`, `server/__tests__/utils/answerCache.node.test.js`.

- [ ] 시험 먼저 작성: `normalizeQuestion('CT 전 금식?')`와 공백/소문자 변형은 같음. `0.5`/`5`, `1 0`/`10`, `1~3`/`13`, `1:2`/`12`, `10mM`/`10mm`는 다름.
- [ ] `createAnswerCache({now})`의 `generation(workspaceId)`, `put({workspaceId,question,value,generation})`, `get(workspaceId,question)`, `invalidate(workspaceId)`, `list(workspaceId)`, `remove(id)`, `clear()`, `stats()` 구현함. 모든 읽기 반환은 복사본임.
- [ ] 전체 100개 LRU, 다른 부서 차단, 이전 세대 put 거절, 출처 객체 보존, hit 증가·삭제/초기화 동작 시험함.
- [ ] 모듈 실패→통과 확인 후 실제 연결 전 코드 검토함. 독립 모듈 통과만으로 기능 완료 처리하지 않음.

## Task 2: 실제 채팅·문서 변경 연결

파일: `server/utils/chats/stream.js`, `server/models/documents.js`, `server/utils/documentUpdates/service.js`, 필요한 문서 삭제/등록 경로와 관련 node:test.

- [ ] 기존 `grepAgents` 앞뒤와 admission 진입 전에 안전한 일반 query의 cache hit 경로를 연결함. 최근 대화/첨부/명령/권한 의존 시 우회함. 현재 모드/모델/프롬프트/문서 버전도 일치해야 재사용하도록 key context 확장함.
- [ ] 정상 완료된 답변만 저장하고 기존 SSE 최종 이벤트·새 질문 기록·출처·체크리스트 연결을 유지함. 실패/중단/부분 답변 저장 금지. 실제 Gemini 호출이 없는 hit은 큐와 하루 호출 집계에서 제외함.
- [ ] 모든 성공한 문서 등록/업데이트/삭제와 workspace 삭제에서 세대 무효화함. 진행 중 변경·실패·롤백 및 늦은 답변 저장을 가짜 의존성으로 시험함. 기존 문서 업데이트 안전 차단을 임의로 해제하지 않음.

## Task 3: 관리자 UI와 완료

파일: 전용 `server/endpoints/answerCache.js`, 서버 endpoint 등록 위치, `frontend/src/pages/SchatAdmin/`의 기존 메뉴 구성과 새 캐시 화면, 전용 관리자 model/API와 node:test.

- [ ] 기존 admin 역할 검사와 workspace 범위 검사 적용. 질문/사용 횟수/저장 시각 조회, 개별 삭제/전체 비우기, 아낀 답변 호출 수 표시함. 원문/키/사용자정보를 추가로 기록하지 않음.
- [ ] 캐시 hit은 최소 일반 답변 호출 1회를 아낀 것으로 계산하며 embedding/Agent 전체 비용 절약이라고 표시하지 않음.
- [ ] 일반 질문 miss/hit, 다른 부서, 숫자 차이, 문서 변경 후 miss, 관리자 권한, 큐/하루집계 제외를 통합 시험함. 실제 API 없이 격리 Docker 사용함.
- [ ] frontend production build, 기존 채팅/체크리스트/문서 업데이트 회귀, 문서 화면 재생성과 분리 검사 후 5단계만 선별 커밋함.
