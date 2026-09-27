# SCHAT Overview Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장소 상태를 안전하게 분석해 비개발자용 SCHAT 설명 JSON과 HTML을 자동 생성한다.

**Architecture:** 표준 라이브러리만 사용하는 Python 수집기가 allowlist 기반으로 저장소와 공식 문서를 분석한다. 기존 HTML 생성기는 수집 결과를 받아 자체 완결형 반응형 페이지와 공개 JSON을 함께 만들며, 비차단 build wrapper와 pre-commit hook이 갱신을 자동화한다.

**Tech Stack:** Python 3 표준 라이브러리, 정적 HTML/CSS/JavaScript, Node.js 비차단 실행 wrapper, Git hook

**Spec:** `docs/superpowers/specs/2026-09-25-schat-overview-automation-design.md`

## Global Constraints

- `.env`, API key, password, token, PDF 및 병원 문서 본문을 읽거나 출력하지 않는다.
- SCHAT 앱의 검색·답변·embedding·ChromaDB·BM25·업로드 로직을 변경하지 않는다.
- 자동 생성 실패가 앱 실행, production build, commit을 막지 않는다.
- 기존 작업일지를 삭제하지 않는다.
- Git commit, tag, push를 실행하지 않는다.

---

### Task 1: 저장소 개요 데이터 수집기

**Files:**
- Create: `문서도구/SCHAT_개요데이터_만들기.py`
- Create: `검사/SCHAT_개요데이터_검사.py`

**Interfaces:**
- Produces: `collect_overview(repository_root: Path) -> dict`, `write_overview_data(repository_root: Path, output_path: Path) -> dict`

- [ ] 격리 fixture에서 폴더, 모델, Docker 서비스, 테스트, 작업일지를 수집하고 secret을 제외하는 실패 테스트를 작성한다.
- [ ] 테스트가 모듈 부재로 실패하는지 확인한다.
- [ ] allowlist 기반 수집기와 공개 JSON writer를 최소 구현한다.
- [ ] fixture 설정 변경이 결과에 반영되는지 포함해 테스트를 통과시킨다.

### Task 2: 설명 HTML renderer

**Files:**
- Modify: `문서도구/문서화면_만들기.py`
- Modify: `검사/문서화면_분리_검사.py`
- Create: `docs/02_인수인계/SCHAT_인수인계.md`

**Interfaces:**
- Consumes: Task 1의 overview dict
- Produces: `docs_view/index.html`, `docs_view/schat-overview-data.json`

- [ ] 6개 섹션, 인수인계 본문, 접힌 변경 이력, 반응형 계약을 검사하는 실패 테스트를 작성한다.
- [ ] 기존 renderer에서 실패하는지 확인한다.
- [ ] 기존 날짜 카드 중심 renderer를 개요 중심 renderer로 교체한다.
- [ ] 기존 문서와 작업일지를 보존하면서 테스트를 통과시킨다.

### Task 3: 비차단 자동 실행

**Files:**
- Create: `scripts/update_schat_overview.mjs`
- Create: `.githooks/pre-commit`
- Modify: `frontend/package.json`
- Modify: `AGENTS.md`

**Interfaces:**
- Node wrapper exits 0 even when Python execution fails.
- Hook regenerates only when monitored staged paths change.

- [ ] wrapper 성공·실패와 hook 경로 감지 행동의 실패 테스트를 작성한다.
- [ ] 테스트 실패를 확인한 뒤 wrapper와 hook을 최소 구현한다.
- [ ] frontend predev/prebuild와 저장소 규칙에 연결한다.
- [ ] local `core.hooksPath`를 `.githooks`로 설정하고 자동 실행 테스트를 통과시킨다.

### Task 4: 문서 현행화와 전체 검증

**Files:**
- Modify: `docs/00_현재상태/현재_프로젝트_상태.md`
- Create: `docs/01_작업일지/2026-09-25_SCHAT_설명화면_자동화.md`
- Modify: `docs/01_작업일지/README.md`
- Generate: `docs_view/index.html`
- Generate: `docs_view/schat-overview-data.json`

- [ ] 생성기를 실행하고 저장 결과가 fresh generation과 일치하는지 확인한다.
- [ ] secret·문서 원문 노출 검사를 실행한다.
- [ ] 문서 검사와 production build를 실행한다.
- [ ] `git diff --check`와 변경 범위를 확인한다.

