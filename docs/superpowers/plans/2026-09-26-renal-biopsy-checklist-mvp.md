# Renal biopsy Checklist MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one end-to-end Renal biopsy p.56 checklist that is extracted from hospital PDF text, stored independently, editable by an administrator, and shown under matching employee chat answers.

**Architecture:** A deterministic server extractor converts only verified Renal biopsy p.56 source strings into a versioned JSON checklist stored under the existing server storage volume. Workspace-authorized APIs publish a sanitized definition and accept administrator edits, while shared React checklist components serve both the document manager and streaming/historical chat paths without touching retrieval or answer generation.

**Tech Stack:** Node.js/CommonJS server utilities, Express workspace endpoints, React/Tailwind frontend, Node test runner, existing AnythingLLM Modal and original PDF viewer infrastructure.

**Spec:** `docs/superpowers/specs/2026-09-26-renal-biopsy-checklist-mvp-design.md`

## Global Constraints

- Implement only the Renal biopsy checklist on `검사 및 시술(26.04.07).pdf` p.56.
- Do not modify Automatic, AgentHandler, rag-memory, Gemini, BM25, Chroma search, embeddings, Citation, original PDF API, login, or database schema.
- Do not call Gemini or any other external API.
- Every automatically stored label/detail must be verifiably present in the PDF-derived source text.
- `검사목적` is informational; only explicit confirmation/action rows are checkable.
- Numbered details such as ① and ② remain details under one item.
- Checklist extraction failure must never fail PDF processing or embedding.
- Do not commit, tag, or push.

---

### Task 1: Deterministic Renal biopsy extractor

**Files:**
- Create: `server/utils/documentChecklists/extractor.js`
- Create: `server/__tests__/utils/documentChecklists/extractor.node.test.js`
- Create: `server/__tests__/utils/documentChecklists/fixtures/renal-biopsy-page-56.txt`

**Interfaces:**
- Produces: `extractRenalBiopsyChecklist({ documentId, filename, page, text }) -> checklist|null`
- Produces: `isRenalBiopsyChecklistCandidate(text) -> boolean`
- Checklist items use `{ id, type, label, details }` with `type` equal to `informational` or `checkable`.

- [ ] Write a failing test fixture containing the exact p.56 extracted source structure and assert candidate detection, both sections, source page, informational/checkable classification, and no generated strings.
- [ ] Run `node --test server/__tests__/utils/documentChecklists/extractor.node.test.js` and confirm failure because the extractor module does not exist.
- [ ] Implement text normalization used only to find fragmented headings, explicit Renal biopsy title/section detection, conservative row-boundary parsing, exact-source validation, and stable derived IDs.
- [ ] Assert `검사목적` has no checkable type, `동의서` has exactly one item with numbered details, and `금식여부`, `IV line`, `검사 전 준비`, `Prepare`, and the exact post-exam rows are checkable only when present.
- [ ] Run the extractor test and confirm all assertions pass.

### Task 2: File repository and safe public shape

**Files:**
- Create: `server/utils/documentChecklists/repository.js`
- Create: `server/utils/documentChecklists/presenter.js`
- Create: `server/__tests__/utils/documentChecklists/repository.node.test.js`

**Interfaces:**
- Consumes: checklist returned by `extractRenalBiopsyChecklist`.
- Produces: `saveAutoChecklist(checklist)`, `updateChecklist(id, patch)`, `findByDocumentIds(ids)`, `getById(id)`.
- Produces: `toPublicChecklist(checklist)` with `id`, `title`, `aliases`, `sections`, `source.filename`, `source.page`, and derived `source.pdfRef`; no `documentId` or filesystem path.

- [ ] Write failing tests for opaque filenames, atomic JSON persistence, immediate active state, idempotent document/page save, edited checklist overwrite protection, and sanitized public output.
- [ ] Run `node --test server/__tests__/utils/documentChecklists/repository.node.test.js` and confirm the expected missing-module failure.
- [ ] Implement versioned JSON storage under `server/storage/document-checklists`, using a hashed storage key and temporary-file rename.
- [ ] Implement strict administrator update validation for title, aliases, section order/title, item order/type/label/details; set `editedByAdmin: true` without accessing document/vector code.
- [ ] Derive `pdfRef` through the existing original-document helper and strip all internal fields.
- [ ] Run repository tests and confirm they pass.

### Task 3: Non-blocking upload extraction and existing p.56 backfill

**Files:**
- Create: `server/utils/documentChecklists/processDocuments.js`
- Create: `server/scripts/schatBackfillRenalBiopsyChecklist.js`
- Create: `server/__tests__/utils/documentChecklists/processDocuments.node.test.js`
- Modify: `server/endpoints/workspaces.js`

**Interfaces:**
- Consumes: Collector `documents` results whose locations point to page JSON files.
- Produces: `processDocumentChecklists(documents) -> {created, skipped, errors}`; it never throws to its upload caller.
- Backfill reads the existing p.56 SourceUnit but writes only the checklist repository.

- [ ] Write failing tests proving successful extraction is saved, non-candidate pages are skipped, extraction/storage exceptions return an error count without rejecting upload, and no vector/BM25 method is invoked.
- [ ] Run the processor test and confirm failure because the processor is missing.
- [ ] Implement page JSON loading through existing safe file utilities, invoke the extractor, and isolate every error.
- [ ] Call the processor after successful Collector processing in `/workspace/:slug/upload` and `/workspace/:slug/upload-and-embed` without changing their success/failure contract.
- [ ] Implement an idempotent one-purpose backfill script for the already indexed Renal biopsy p.56 source; verify it does not perform update/upsert/delete against Chroma.
- [ ] Run processor tests and the backfill dry run; record the created checklist path without printing hospital source text or internal IDs.

### Task 4: Workspace-authorized checklist APIs

**Files:**
- Modify: `server/endpoints/workspaces.js`
- Create: `server/__tests__/endpoints/workspaceChecklists.node.test.js`

**Interfaces:**
- Produces: `GET /workspace/:slug/checklists` for users with workspace access.
- Produces: `PUT /workspace/:slug/checklists/:checklistId` for admin/manager roles.
- Uses workspace document metadata to filter repository entries by internal document ID before applying public presentation.

- [ ] Write failing endpoint/source-contract tests for allowed workspace lookup, forbidden unrelated workspace, manager/admin update, employee update denial, 404, and public-field sanitation.
- [ ] Run the endpoint test and confirm missing-route/contract failure.
- [ ] Add the GET and PUT routes using existing `validatedRequest`, user/workspace lookup, and role middleware patterns.
- [ ] Ensure update accepts only checklist-definition fields and never calls Document, vector DB, BM25, or original PDF mutation methods.
- [ ] Run endpoint and server checklist tests.

### Task 5: Shared checklist frontend, alias matching, and historical support

**Files:**
- Create: `frontend/src/models/checklist.js`
- Create: `frontend/src/utils/checklistMatcher.js`
- Create: `frontend/src/utils/checklistMatcher.node.test.mjs`
- Create: `frontend/src/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistModal.jsx`
- Create: `frontend/src/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistLauncher.jsx`
- Create: `frontend/src/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/checklist.renderer.node.test.mjs`
- Modify: `frontend/src/components/WorkspaceChat/ChatContainer/ChatHistory/index.jsx`
- Modify: `frontend/src/components/WorkspaceChat/ChatContainer/ChatHistory/PromptReply/index.jsx`
- Modify: `frontend/src/components/WorkspaceChat/ChatContainer/ChatHistory/HistoricalMessage/index.jsx`

**Interfaces:**
- Produces: `matchChecklists(question, checklists) -> checklist[]` using only the four approved aliases, case-insensitively.
- `ChatHistory` loads checklist definitions once per workspace and associates each assistant message with the nearest preceding user message.
- `ChecklistLauncher` owns transient checkbox state so closing/reopening its modal preserves state while a page refresh resets it.

- [ ] Write failing matcher tests for both approved example questions, case insensitivity, and non-match for `수혈 절차 알려줘`.
- [ ] Write failing renderer contract tests for answer → checklist → Citation order, modal accessibility, two independently collapsible expanded sections, informational rows without checkbox, checkable rows with one checkbox, numbered details as plain text, dark/mobile classes, and transient state ownership.
- [ ] Run the new frontend node tests and confirm missing-module/markup failures.
- [ ] Implement the checklist model GET request and normalized exact alias matcher.
- [ ] Implement modal and launcher with existing Modal components, max-width 640px, internal scrolling, X/footer close, ESC close, section toggles, and controlled checkbox state.
- [ ] Pass matched checklists into both streaming `PromptReply` and reloaded `HistoricalMessage`; render the launcher after answer content and before Citation.
- [ ] Run matcher/renderer tests and relevant existing chat tests.

### Task 6: Administrator view/edit/original-page controls

**Files:**
- Modify: `frontend/src/models/checklist.js`
- Create: `frontend/src/components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/OriginalPdfRow/ChecklistControls.jsx`
- Create: `frontend/src/components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/OriginalPdfRow/ChecklistEditor.jsx`
- Create: `frontend/src/components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/OriginalPdfRow/checklistControls.node.test.mjs`
- Modify: `frontend/src/components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/OriginalPdfRow/index.jsx`
- Modify: `frontend/src/components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/index.jsx`

**Interfaces:**
- `ChecklistControls` receives public checklists belonging to its grouped PDF row.
- View reuses `ChecklistModal`; edit persists through the PUT endpoint; original view reuses the existing authenticated `PdfPageViewer` with checklist `source.pdfRef` and page 56.

- [ ] Write failing renderer tests for auto-generated status, view/edit/original buttons, no approval button, editable title/sections/items/details/order/add/delete, and p.56 viewer wiring.
- [ ] Run the control test and confirm missing-component failure.
- [ ] Load workspace checklists alongside the directory data and associate them to PDF rows using public `pdfRef`.
- [ ] Implement view and edit modals; ensure save sends only checklist JSON fields and refreshes checklist state.
- [ ] Reuse the existing PDF page viewer for p.56 without creating a storage or API path.
- [ ] Run administrator UI contract tests and existing workspace-directory tests.

### Task 7: End-to-end verification and documentation

**Files:**
- Modify: `docs/00_현재상태/현재_프로젝트_상태.md`
- Create or modify: `docs/01_작업일지/2026-09-26_Renal_biopsy_체크리스트_MVP.md`
- Generated: `docs_view/index.html`
- Generated: `docs_view/schat-overview-data.json`

**Interfaces:**
- Consumes the implemented server/frontend feature and the existing Docker environment.
- Produces fresh automated and browser evidence without Gemini calls.

- [ ] Capture the pre-verification body-vector count and deterministic snapshot hash using the existing read-only Chroma verification method.
- [ ] Run all new backend/frontend tests plus existing Citation, PDF viewer, upload, workspace-directory, and chat renderer regressions.
- [ ] Run the production frontend build.
- [ ] Rebuild/restart only the required Docker service using the existing compose file, then confirm all three services are healthy.
- [ ] Run the idempotent Renal biopsy backfill and confirm one active p.56 checklist exists without vector mutation.
- [ ] In the real Docker browser, log in through the existing local test account without displaying credentials; verify administrator list controls, read-only content, editor opening, and original PDF p.56.
- [ ] Reuse a saved matching chat if available; otherwise exercise the UI with a local mocked/stored assistant entry without sending a Gemini request. Verify checklist button, modal, informational/checkable rendering, section collapse, checkbox toggle, close/reopen state, and unrelated-question non-match.
- [ ] Compare every displayed label/detail with the actual p.56 source and report missing, excessive, or misclassified rows. Do not mark complete if any generated content is absent from the source.
- [ ] Recompute the body-vector count/snapshot and confirm it matches the pre-verification value.
- [ ] Update current-state and work-log documentation, run `python 문서도구/문서화면_만들기.py`, then run `python 검사/문서화면_분리_검사.py`.
- [ ] Run `git diff --check` and report only verified outcomes; do not commit, tag, or push.
