# SCHAT 문서 통합 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 사람이 자주 보는 SCHAT 문서를 정본 중심으로 줄이고, 끝난 계획과 중간 기록을 안전하게 정리함.

**Architecture:** 배포 코드와 운영 데이터 경로는 유지함. 현재 상태·버전·멘토링·개발복기·운영 인수인계 정본에 고유 정보를 먼저 합친 뒤, 참조를 새 정본으로 바꾸고 대체된 문서만 삭제함.

**Tech Stack:** Markdown, Python 문서 생성기, Git, Docker Compose

**Spec:** 사용자 요청과 2026-10-01 문서 중복 분석 결과를 기준으로 함.

## Global Constraints

- 프로그램 코드, Docker 설정, `.env`, DB, `server/storage`와 운영 자료를 삭제하거나 이동하지 않음.
- 작업 전 현재 상태를 Git 보호 커밋으로 저장함.
- 작업일지는 핵심 기록만 남기고 나머지는 보호 커밋과 Git 이력에서 복원 가능하게 함.
- Markdown 정본을 `docs_view`가 읽는 구조를 유지함.
- push와 tag를 실행하지 않음.

---

### Task 1: 현재 상태 보호

**Files:** 현재 Git 변경 전체

- [ ] 비밀값과 Git 제외 경로를 검사함.
- [ ] 현재 변경 전체를 보호 커밋으로 저장함.
- [ ] 보호 커밋 번호를 기록함.

### Task 2: 정본 문서 통합

**Files:**
- Modify: `00_읽어보기.md`
- Modify: `docs/00_현재상태/현재_프로젝트_상태.md`
- Modify: `docs/02_멘토링/2026-09-19_멘토링_한눈에_보기.md`
- Modify: `docs/02_멘토링/2026-09-19_멘토링_상세근거.md`
- Modify: `05_인수인계/SCHAT_개발_복기와_AI협업_인수인계.md`
- Modify: `05_인수인계/SCHAT_인수인계.md`
- Modify: `04_화면디자인/README.md`

- [ ] Claude 개발복기의 고유 시행착오를 개발복기 정본에 요약함.
- [ ] 멘토링 산출물의 현재 기준·평가·버전 4 계획을 상세근거에 통합함.
- [ ] 로컬 실행과 구조 설명을 운영 인수인계 정본에 통합함.
- [ ] 사람이 최종적으로 볼 문서와 역할을 첫 안내에 명시함.

### Task 3: 작업일지 축소

**Files:**
- Modify: `docs/01_작업일지/README.md`
- Delete: 정본에 반영된 단순 중간 작업일지

- [ ] 기능 전환점·중요 오류·최근 운영 변경 기록만 남김.
- [ ] 삭제하는 기록의 제목과 핵심 흐름을 README 연대표에 남김.
- [ ] 모든 삭제 기록이 보호 커밋에서 복원 가능한지 확인함.

### Task 4: 대체된 문서 삭제와 참조 정리

**Files:**
- Delete: 완료된 멘토링 계획·중간 산출물
- Delete: 통합이 끝난 Claude 개발복기와 저장소 내 중복 Word 개발복기
- Modify: `README.md`, `CLAUDE.md`, `AGENTS.md`, 문서 생성기와 검사

- [ ] 삭제 대상의 고유 정보가 정본에 있는지 재확인함.
- [ ] Markdown 링크와 생성기 입력을 정본으로 변경함.
- [ ] 과거 파일명 자체가 역사적 증거인 Git 기록은 보호 커밋에서 보존함.

### Task 5: 생성과 검증

**Files:**
- Regenerate: `docs_view/index.html`
- Regenerate: `docs_view/schat-overview-data.json`

- [ ] `python 문서도구/문서화면_만들기.py`를 실행함.
- [ ] 문서 관련 검사를 실행함.
- [ ] 깨진 Markdown 링크와 삭제 파일 참조를 검사함.
- [ ] `git diff --check`를 실행함.
- [ ] Docker Compose 설정 검증과 가능한 Docker build를 실행함.
- [ ] 기능 코드와 운영 데이터 변경이 없는지 확인함.

### Task 6: 정리 결과 저장

**Files:** 정리된 문서와 생성 결과

- [ ] 정리 전후 문서 수를 계산함.
- [ ] 정리 결과를 두 번째 Git 커밋으로 저장함.
- [ ] push와 tag를 실행하지 않았는지 확인함.
