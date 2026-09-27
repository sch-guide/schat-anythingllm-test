# 직원 채팅 Python 안전검사 연결 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반 직원 채팅의 Gemini 후보를 브라우저에 보내기 전에 기존 Python SCHAT 안전검사로 검증하고, 실패·장애 시 원문 기반 답변만 표시한다.

**Architecture:** Node.js는 기존 로그인·검색·Gemini 호출을 유지하되 안전 모드에서는 후보를 버퍼에 보관한다. 외부 포트가 없는 Python Docker 서비스가 SourceUnit 생성과 기존 validator 실행을 소유하며, Node.js는 PASS 결과 또는 서비스가 만든 extractive fallback만 저장·전송한다.

**Tech Stack:** Node.js 18, Jest, Python 3.12, Pydantic, 표준 라이브러리 HTTP 서버, Docker Compose

**Spec:** 2026-09-23 사용자 승인 메시지와 직전 채팅 설계

## Global Constraints

- 기존 Python validator를 완화하거나 JavaScript로 재작성하지 않는다.
- Gold, fixture, DB schema, 기존 검색 데이터는 변경하지 않는다.
- 검사 전 Gemini 후보를 브라우저에 전송하지 않는다.
- 실패·오류·시간초과는 모두 fail-closed이며 retry는 0이다.
- Git commit, tag, push를 수행하지 않는다.

---

### Task 1: 안전검사 HTTP 계약과 Python 서비스

**Files:**
- Create: `safety-evaluator/service.py`
- Create: `safety-evaluator/contracts.py`
- Create: `safety-evaluator/requirements.txt`
- Create: `safety-evaluator/tests/test_service.py`

**Interfaces:**
- Consumes: 검색 청크와 구조화 candidate JSON
- Produces: `POST /v1/prepare`, `POST /v1/validate`, `GET /healthz`

- [ ] SourceUnit 생성, 계약 지문, extractive fallback 테스트를 먼저 작성하고 실패를 확인한다.
- [ ] 숫자·단위·시간·조건·부정·금기·행위 종류·강도 실패 테스트를 작성하고 실패를 확인한다.
- [ ] 기존 `src.controlled_generation`, `src.evidence`, `tools.evaluation_action_strength`를 호출하는 최소 서비스를 구현한다.
- [ ] 원문 없는 진단, retry 0, 잘못된 요청 fail-closed를 검증한다.

### Task 2: Node.js 안전검사 호출기

**Files:**
- Create: `server/utils/schatSafety/client.js`
- Create: `server/utils/schatSafety/finalize.js`
- Create: `server/__tests__/utils/schatSafety/client.test.js`
- Create: `server/__tests__/utils/schatSafety/finalize.test.js`

**Interfaces:**
- Consumes: 검색 sources, 질문, Gemini candidate
- Produces: 화면에 표시 가능한 `{text, sources, safety}` snapshot

- [ ] PASS·FAIL·timeout·연결 실패·응답 형식 오류 테스트를 먼저 작성하고 실패를 확인한다.
- [ ] 재시도 없이 1회 호출하고 모든 오류를 fallback으로 바꾸는 client를 구현한다.
- [ ] candidate와 citation이 하나의 snapshot으로 선택되는 finalize 함수를 구현한다.

### Task 3: 일반 채팅 후보 비노출

**Files:**
- Modify: `server/utils/chats/stream.js`
- Modify: `server/utils/vectorDbProviders/chroma/index.js`
- Create: `server/__tests__/utils/chats/schatSafetyStream.test.js`

**Interfaces:**
- Consumes: 현재 Gemini connector와 Chroma+BM25 sources
- Produces: 검사 완료 후 단일 `textResponseChunk`

- [ ] 검사 전 `writeResponseChunk`에 candidate가 전달되지 않는 테스트를 작성하고 실패를 확인한다.
- [ ] 안전 모드에서 streaming provider를 사용하지 않고 `getChatCompletion`으로 완성 후보를 메모리에만 보관한다.
- [ ] Python PASS 또는 fallback 결과만 저장·전송한다.
- [ ] Chroma 결과에 실제 vector/chunk ID와 기존 metadata를 보존한다.

### Task 4: 직원용 출처 표시

**Files:**
- Modify: `frontend/src/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/index.jsx`
- Create or modify: matching frontend test file

**Interfaces:**
- Consumes: source의 `document_name`, `page`, `section`
- Produces: `문서명 · p.페이지 · 항목명`

- [ ] 내부 ID가 표시되지 않는 테스트를 먼저 작성한다.
- [ ] 확인 가능한 값만 결합해 직원용 출처 문자열을 표시한다.

### Task 5: Docker 내부 서비스

**Files:**
- Create: `docker/safety-evaluator.Dockerfile`
- Modify: `docker/docker-compose.yml`
- Modify: `docker/.env.example`

**Interfaces:**
- Consumes: 내부망 HTTP 요청
- Produces: healthy `schat-safety-evaluator` service

- [ ] 외부 port가 없고 healthcheck·read-only·내부망·API key 없음이 유지되는지 정적 검사한다.
- [ ] Compose를 빌드하고 세 컨테이너의 healthy 상태를 확인한다.

### Task 6: 회귀·보안·문서 검증

**Files:**
- Modify: `docs/00_현재상태/현재_프로젝트_상태.md`
- Create: `docs/01_작업일지/2026-09-23_Python_안전검사_직원채팅_연결.md`
- Regenerate: `docs_view/`

**Interfaces:**
- Consumes: 구현 및 검증 결과
- Produces: 비개발자용 현재 상태와 작업일지

- [ ] Python 집중 테스트, Node 집중 테스트, 전체 관련 테스트를 실행한다.
- [ ] Docker 재시작과 Chroma 볼륨 유지를 확인한다.
- [ ] Ruff, lint, `git diff --check`, raw/API-key 보안 검사를 실행한다.
- [ ] 일반 로그인·검색 경로와 후보 비노출을 재확인하고 실제 제한점을 문서화한다.
