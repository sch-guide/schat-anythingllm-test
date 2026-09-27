# Image Description Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 누락된 이미지 설명을 안전하게 일괄 보충하고 새 PDF에서는 SHA-256 hash 기준으로 자동 증분 처리한다.

**Architecture:** 기존 PDF 이미지 cache와 backfill 스크립트를 하나의 상태 형식으로 맞춘다. backfill은 bounded batch와 원자적 진행상태를 사용하고, 업로드 경로는 같은 cache 판정을 재사용한다. 설명 성공 결과만 기존 Chroma collection에 보조 벡터로 upsert한다.

**Tech Stack:** Node.js, `node:test`, Gemini OpenAI-compatible API, Gemini Embedding 2, ChromaDB, Prisma/SQLite, Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-26-image-description-backfill-design.md`

## Global Constraints

- Automatic, AgentHandler, BM25, UI 및 기존 본문 벡터를 변경하지 않는다.
- dry-run의 고유 이미지가 1,172개를 초과하거나 Vision 신규 대상이 1,138개를 초과하면 외부 호출을 시작하지 않는다.
- API key, 내부 이미지 경로와 병원 원문을 로그에 출력하지 않는다.
- Git commit, tag, push를 실행하지 않는다.

---

### Task 1: 상태 cache와 batch 처리 계약

**Files:**
- Modify: `collector/processSingleFile/convert/asPDF/pdfImages.js`
- Test: `collector/__tests__/processSingleFile/convert/asPDF/pdfImages.node.test.js`

**Interfaces:**
- Produces: `readDescriptionCacheRecord(cachePath)`, `writeDescriptionCacheRecord(cachePath, record)`, 성공·빈 응답·실패 상태를 반환하는 bounded description 처리

- [ ] 기존 성공 cache는 호출 없이 재사용하는 실패 테스트를 작성한다.
- [ ] 빈 응답과 오류가 상태 cache에 기록되고 다음 실행에서 재호출되지 않는 실패 테스트를 작성한다.
- [ ] batch 완료 callback과 최대 실행 상한 실패 테스트를 작성한다.
- [ ] 테스트가 기대한 이유로 실패하는지 실행한다.
- [ ] 최소 구현 후 관련 테스트를 통과시킨다.

### Task 2: PDF 업로드 자동 증분 처리

**Files:**
- Modify: `collector/processSingleFile/convert/asPDF/index.js`
- Modify: `docker/docker-compose.yml`
- Modify: `docker/.env.example`
- Test: `collector/__tests__/processSingleFile/convert/asPDF/index.node.test.js`

**Interfaces:**
- Consumes: Task 1의 hash cache와 bounded 처리
- Produces: 기존 hash 재사용, 새 hash만 설명, 실패해도 본문 문서 생성 계속

- [ ] 기존 hash, 신규 hash, 다른 페이지 재사용, 실패, 이미지 없음, 재업로드 테스트를 먼저 작성한다.
- [ ] 테스트가 기대한 이유로 실패하는지 실행한다.
- [ ] batch size와 max-per-run 설정을 연결하고 최소 구현한다.
- [ ] 관련 collector 테스트를 통과시킨다.

### Task 3: 재개 가능한 전체 backfill

**Files:**
- Modify: `server/scripts/schatBackfillPdfImageDescriptions.js`
- Test: `server/__tests__/scripts/schatBackfillPdfImageDescriptions.node.test.js`

**Interfaces:**
- Consumes: Task 1 cache 상태
- Produces: dry-run summary, batch progress, 기존 hash/vector 재사용, 성공 설명 보조 벡터 upsert

- [ ] 1,172/1,138 상한, batch 재개, 기존 벡터 중복 재사용 테스트를 먼저 작성한다.
- [ ] 테스트가 기대한 이유로 실패하는지 실행한다.
- [ ] dry-run과 apply를 구현하고 기존 본문 vector snapshot 검증을 유지한다.
- [ ] 관련 server 테스트를 통과시킨다.

### Task 4: 실제 dry-run과 승인 범위 backfill

**Files:**
- Data only: `server/storage/document-images/.description-cache/`
- Data only: 기존 processed document metadata, SQLite vector mapping, Chroma image-description vectors

**Interfaces:**
- Consumes: Task 3 CLI
- Produces: 50개 이하 내부 batch, 재개 상태, 최종 집계

- [ ] dry-run으로 총 이미지·기존 설명·cache·신규 호출·vector 중복을 확인한다.
- [ ] 승인 범위를 넘으면 중단한다.
- [ ] 승인 범위 안이면 apply를 한 번 실행하고 진행상태를 감시한다.
- [ ] 성공·빈 응답·실패·cache 재사용·Vision 호출·vector 수를 확인한다.
- [ ] 본문 vector snapshot이 작업 전후 동일한지 확인한다.

### Task 5: 회귀·대표 문서·문서화 검증

**Files:**
- Modify: `docs/00_현재상태/현재_프로젝트_상태.md`
- Create: `docs/01_작업일지/2026-09-26_이미지설명_전체보충과_자동증분.md`
- Generated: `docs_view/index.html`
- Generated: `docs_view/schat-overview-data.json`

**Interfaces:**
- Produces: 검증 결과와 비개발자용 현행 문서

- [ ] NRS, FPRS, 수혈 p.117·124, 중심정맥관 p.316, CRE 대상 페이지를 로컬 데이터로 확인한다.
- [ ] 관련 회귀 테스트와 production build를 실행한다.
- [ ] Docker 3개 healthcheck를 확인한다.
- [ ] 문서 생성·분리 검사와 `git diff --check`를 실행한다.
- [ ] 확인된 결과만 상태 문서와 작업일지에 기록한다.
