# 질문 범위 기반 안전검사 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 질문에 필요한 필수 임상 사실만 검사하면서 위험한 의미 변경은 계속 차단한다.

**Architecture:** 테스트 저장소의 Python 안전검사 어댑터에 질문 범위 정책과 안전한 표 처리 모듈을 추가한다. 원본 SCHAT 검사기를 `require_all_evidence=False`로 호출하되, 새 필수 사실 묶음 검사를 바로 이어 실행해 무조건적인 완화를 방지한다.

**Tech Stack:** Python, pytest, Node.js, Jest, Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-23-question-scoped-safety-design.md`

## Global Constraints

- 원본 SCHAT Python validator, Gold, fixture, DB schema를 변경하지 않는다.
- MiniLM, 외부 웹검색, 자동 재시도는 추가하지 않는다.
- Git commit/tag/push를 수행하지 않는다.
- 실제 Gemini 호출은 마지막 네 질문에 각 최대 한 번만 허용한다.

## Review Focus

- 선택 근거를 생략할 때 필수 종류나 절차 단계까지 누락되지 않는가.
- 숫자 없는 조건·부정·행위 변경이 자연스러운 표현으로 잘못 허용되지 않는가.
- 성인·소아 및 서로 다른 제제 근거가 한 답변에서 섞이지 않는가.
- 평면화된 표에서 불확실한 행·열 관계를 추측하지 않는가.
- 검사 전 Gemini 후보가 직원 화면에 노출되지 않는가.

---

### Task 1: 질문 범위 정책

**Files:**
- Create: `safety_evaluator/coverage_policy.py`
- Modify: `safety_evaluator/core.py`
- Test: `safety_evaluator/tests/test_question_scoped_coverage.py`

**Interfaces:**
- Produces: `build_coverage_policy(question, units)`와 `validate_required_coverage(policy, candidate, units)`.
- Consumes: 기존 `SourceUnit`, 후보 `statements` 구조.

- [ ] 허용·차단 사례를 재현하는 실패 테스트를 작성하고 실패를 확인한다.
- [ ] 질문 의도별 필수 SourceUnit 묶음과 경고 목록을 생성한다.
- [ ] 기존 검사기의 전체 근거 반복 요구를 끄고 새 필수 사실 검사를 연결한다.
- [ ] 위험 검사와 질문 범위 검사를 모두 통과하는지 집중 테스트한다.

### Task 2: 안전한 표 근거 표시

**Files:**
- Create: `safety_evaluator/table_evidence.py`
- Modify: `safety_evaluator/core.py`
- Test: `safety_evaluator/tests/test_table_evidence.py`

**Interfaces:**
- Produces: `extract_verified_table_items(text, question, section)`.
- Consumes: 정리된 원문과 질문 의도.

- [ ] 검증 가능한 종류 행과 불확실한 평면 표를 구분하는 실패 테스트를 작성한다.
- [ ] 결정적으로 확인되는 행만 목록과 SourceUnit으로 변환한다.
- [ ] 불확실한 표는 raw 문자열을 표시하지 않도록 한다.
- [ ] 페이지·내부 태그·SVG가 본문에 섞이지 않는지 테스트한다.

### Task 3: Node 경계와 회귀검증

**Files:**
- Modify only if required: `server/utils/schatSafety/finalize.js`
- Test: `server/__tests__/utils/schatSafety/chat.test.js`
- Test: `server/__tests__/utils/schatSafety/finalize.test.js`

**Interfaces:**
- Consumes: Python의 PASS/FAIL/경고 결과.
- Produces: 검증 후 candidate 또는 안전한 fallback만 직원 화면에 표시.

- [ ] 검사 전 후보 미노출, retry 0, 출처 정규화 회귀 테스트를 실행한다.
- [ ] 기존 이미지·텍스트 채팅 테스트를 실행한다.
- [ ] 저장된 UAT 결과를 읽기 전용으로 확인하고 적용 가능한 회귀 테스트를 실행한다.

### Task 4: 통합 검증과 실제 네 질문

**Files:**
- Modify: 관련 작업일지와 문서 현황
- Generated: `docs_view/index.html`

**Interfaces:**
- Consumes: 자동검사를 통과한 Python/Node 구현.
- Produces: 최신 Docker 이미지와 네 질문의 1회 검수 결과.

- [ ] Python 집중/전체 테스트와 Node 집중/전체 테스트를 실행한다.
- [ ] 정적 검사, `git diff --check`, 변경 보안 점검을 실행한다.
- [ ] Docker 이미지를 빌드하고 세 서비스를 정상 기동한다.
- [ ] 지정된 네 질문만 각 1회, retry 0으로 실행한다.
- [ ] 결과와 제한점을 작업일지 및 문서 화면에 반영한다.
