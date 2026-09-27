# 직원 채팅 시범운영 안정화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 직원 채팅의 구조화 답변, 출처 표시, 검색 정밀도와 Docker 반영을 최소 변경으로 안정화하고 승인된 합성 문서 질문 1건으로 확인한다.

**Architecture:** Python 안전검사가 만든 JSON 설계도를 Node.js가 Gemini 구조화 출력 옵션으로 그대로 전달한다. 검색 결과는 Gemini/Chroma 의미 점수와 BM25 단어 일치도를 모두 보존한 뒤, 의미 점수가 최고 결과보다 크게 낮고 단어 일치도도 낮은 꼬리 결과만 제거한다. 출처는 저장된 값만 사용하고 깨진 문자와 `Unknown` 같은 자리표시자는 화면에서 생략한다.

**Tech Stack:** Node.js, Jest/Node test runner, Python/pytest, Gemini OpenAI 호환 API, ChromaDB, Docker Compose

**Spec:** 사용자 요청(2026-09-23 직원 채팅 시범운영 안정화)

## Global Constraints

- 기존 Python 안전검사 기준을 완화하지 않는다.
- Gemini 실제 질문은 자동검사와 Docker 검증 후 승인된 합성 문서로 1회만 실행한다.
- 자동 재시도는 0회로 유지한다.
- Gold, fixture, DB schema, 기존 데이터는 변경하거나 삭제하지 않는다.
- MiniLM을 도입하지 않는다.
- Git commit, tag, push를 실행하지 않는다.

---

### Task 1: Gemini 구조화 출력 계약 전달

**Files:**
- Modify: `server/utils/schatSafety/chat.js`
- Modify: `server/utils/AiProviders/gemini/index.js`
- Test: `server/__tests__/utils/schatSafety/chat.test.js`
- Test: `server/__tests__/utils/AiProviders/gemini/index.test.js`

**Interfaces:**
- Consumes: Python `/v1/prepare` 응답의 `structured_output_schema`
- Produces: `getChatCompletion(..., { responseSchema })`와 Gemini `response_format`

- [ ] 정상 JSON, 잘못된 JSON, 필수 필드 누락, 잘못된 SourceUnit ID가 각각 PASS 또는 fallback 되는 테스트를 먼저 작성한다.
- [ ] 구조화 출력 설계도가 Gemini 요청에 전달되지 않아 테스트가 실패하는 것을 확인한다.
- [ ] Gemini OpenAI 호환 요청에 JSON 설계도를 전달하는 최소 코드를 작성한다.
- [ ] 관련 Node.js와 Python 안전검사 테스트를 실행한다.

### Task 2: 출처 메타데이터 정리

**Files:**
- Modify: `server/utils/schatSafety/chat.js`
- Modify: `server/utils/schatSafety/finalize.js`
- Modify: `server/utils/vectorDbProviders/chroma/sourceIdentity.js`
- Test: `server/__tests__/utils/schatSafety/chat.test.js`
- Test: `server/__tests__/utils/schatSafety/finalize.test.js`
- Test: `server/__tests__/utils/vectorDbProviders/chroma/sourceIdentity.test.js`

**Interfaces:**
- Consumes: Chroma 메타데이터와 문서-벡터 연결 정보
- Produces: 내부 식별자는 유지하되 직원 화면에는 문서명·존재하는 페이지·존재하는 항목명만 표시

- [ ] 깨진 문자, `Unknown`, 누락된 페이지·항목명 사례의 실패 테스트를 작성한다.
- [ ] `description`을 임의로 항목명으로 사용하지 않고, 실제 `section`만 보존하도록 수정한다.
- [ ] 깨진 문자는 제거하고 저장된 대체 문서명이 있을 때만 사용하도록 수정한다.
- [ ] 내부 ID가 직원 화면에 나오지 않는지 확인한다.

### Task 3: 관련성 낮은 검색 꼬리 제거

**Files:**
- Modify: `server/utils/vectorDbProviders/chroma/schatBm25.js`
- Modify: `server/utils/vectorDbProviders/chroma/index.js`
- Test: `server/__tests__/utils/vectorDbProviders/chroma/schatBm25.node.test.js`

**Interfaces:**
- Consumes: Gemini 코사인 유사도, BM25 점수와 질문 단어 일치도
- Produces: 병원 약어·정확 용어 결과는 보존하고 두 신호 모두 약한 결과만 제외한 최종 후보

- [ ] 최고 의미 점수와 차이가 크고 BM25 질문 단어 일치도도 낮은 결과가 제거되는 실패 테스트를 작성한다.
- [ ] 정확한 약어·용어의 BM25 단독 결과가 유지되는 테스트를 작성한다.
- [ ] 특정 문서명이나 질문 문자열을 사용하지 않는 일반 필터를 최소 구현한다.
- [ ] 수정 전 기록된 결과와 수정 후 실제 1건 결과를 비교할 수 있도록 점수 없는 원문은 로그에 남기지 않는다.

### Task 4: 전체 자동검사와 Docker 반영

**Files:**
- Modify: `docs/00_현재상태/현재_프로젝트_상태.md`
- Modify: `docs/01_작업일지/2026-09-23_직원계정과_실제질문_검수.md`
- Generate: `docs_view/index.html`

- [ ] 집중 Node.js·Python 테스트, 전체 관련 테스트, 문서 검사와 `git diff --check`를 실행한다.
- [ ] `docker compose build` 후 기존 볼륨을 삭제하지 않고 서비스를 재기동한다.
- [ ] 웹·ChromaDB·Python 안전검사가 모두 healthy인지 확인한다.
- [ ] 기존 Chroma 벡터 수, 직원 계정, 검색 설정이 유지됐는지 확인한다.

### Task 5: 직원 계정 실제 질문 1건

**Files:**
- No production file changes after the call unless a bounded defect is reproduced by a failing local test.

- [ ] 기존 제한 직원 계정으로 로그인한다(비밀번호를 출력하지 않는다).
- [ ] 승인된 합성 비민감 문서 질문을 정확히 1회 실행한다.
- [ ] 새 검색, 구조화 JSON, Python 안전검사, 후보 미노출, 최종 답변과 출처를 확인한다.
- [ ] 추가 Gemini 질문 없이 결과를 문서화하고 종료한다.
