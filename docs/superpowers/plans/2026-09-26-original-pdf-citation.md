# Original PDF Citation Implementation Plan

> **For agentic workers:** Execute inline with `superpowers:executing-plans`; every production behavior begins with a failing test.

**Goal:** Preserve uploaded PDF originals and show the exact cited PDF page in Citation, with excerpt fallback.

**Architecture:** A focused original-document storage helper owns PDF validation, deterministic opaque references, duplicate protection and workspace resolution. Existing upload routes call it before the collector deletes the hotdir file; authenticated workspace routes attach or stream originals. Citation fetches the protected PDF as a blob and uses the browser viewer with a page fragment.

**Tech Stack:** Node.js, Express, multer, React, browser PDF viewer, node:test, esbuild.

**Spec:** `docs/superpowers/specs/2026-09-26-original-pdf-citation-design.md`

## Global Constraints

- Do not change Automatic, AgentHandler, rag-memory, Gemini, BM25, Chroma retrieval or body vectors.
- Do not add a PDF viewer dependency or a database migration.
- Never expose `document_id`, vector IDs or filesystem paths to employees.
- Do not commit, tag or push.

## Review Focus

- A non-PDF renamed to `.pdf` must be rejected before storage.
- A different PDF must not silently replace an already linked original.
- A valid `pdfRef` from another workspace must return 404.
- Malformed and multi-range requests must fail safely.
- Citation must retain excerpt and direct-image fallback when PDF loading fails.

---

### Task 1: Original PDF storage boundary

**Files:**
- Create: `server/utils/originalDocuments.js`
- Test: `server/__tests__/utils/originalDocuments.node.test.js`
- Modify: `server/.gitignore`

**Produces:** PDF validation, opaque ref generation, duplicate-safe persistence, workspace resolution and byte-range parsing.

- [ ] Write tests for valid storage, invalid PDF, same-file no-op, different-file conflict, workspace-scoped resolution and ranges.
- [ ] Run tests and confirm failure because the helper is missing.
- [ ] Implement the minimal helper.
- [ ] Run tests and confirm pass.

### Task 2: Upload preservation and authenticated routes

**Files:**
- Modify: `server/utils/files/multer.js`
- Modify: `server/endpoints/workspaces.js`
- Test: `server/__tests__/utils/originalPdfUpload.node.test.js`

**Consumes:** Task 1 storage functions.

**Produces:** Automatic preservation for GUI PDF uploads, original-only attachment, and authenticated range-capable streaming.

- [ ] Write failing upload contract tests.
- [ ] Generate a collector `document_id` before PDF processing and preserve the hotdir file once.
- [ ] Add admin/manager attachment and all-user workspace-scoped read routes.
- [ ] Verify processing failure only removes a newly staged original.

### Task 3: Public source and manager document metadata

**Files:**
- Modify: `server/utils/agents/aibitat/utils/ragSources.js`
- Modify: `server/utils/files/index.js`
- Test: `server/__tests__/utils/agents/aibitat/ragSources.node.test.js`
- Test: `server/__tests__/utils/files/originalPdfPicker.node.test.js`

**Consumes:** Task 1 opaque reference functions.

**Produces:** Public `pdfRef` and `originalPdfAvailable` without internal IDs or paths.

- [ ] Add failing tests for PDF sources, non-PDF sources and picker metadata.
- [ ] Add only the public fields required by Citation and the manager row.
- [ ] Confirm existing excerpt and source fields remain unchanged.

### Task 4: Existing-document attachment UI

**Files:**
- Modify: `frontend/src/models/workspace.js`
- Modify: `frontend/src/components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/workspaceDocumentPresentation.js`
- Modify: `frontend/src/components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/OriginalPdfRow/index.jsx`
- Modify: `frontend/src/components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/index.jsx`
- Test: `frontend/src/components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/workspaceDocumentPresentation.node.test.mjs`

**Produces:** A PDF-only `원본 PDF 연결` control on each original PDF row.

- [ ] Write failing grouping/status tests.
- [ ] Add the multipart model call and row control.
- [ ] Refresh metadata after a successful link without embedding or reindexing.

### Task 5: Citation PDF viewer with fallback

**Files:**
- Modify: `frontend/src/models/files.js`
- Create: `frontend/src/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/PdfPageViewer.jsx`
- Modify: `frontend/src/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/index.jsx`
- Test: `frontend/src/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/sourceEvidence.node.test.mjs`

**Produces:** Authenticated browser PDF viewing at the cited page and excerpt/image fallback.

- [ ] Add failing PDF/fallback rendering tests.
- [ ] Fetch a PDF blob with existing auth headers and revoke object URLs on cleanup.
- [ ] Render the browser viewer at `#page=N&view=FitH`.
- [ ] Hide duplicate source images only after the PDF loads.

### Task 6: Documentation and verification

**Files:**
- Modify: `docs/00_현재상태/현재_프로젝트_상태.md`
- Create: `docs/01_작업일지/2026-09-26_원본PDF_Citation_페이지표시.md`
- Regenerate: `docs_view/`

- [ ] Run focused backend and frontend tests.
- [ ] Run frontend production build.
- [ ] Run Docker health checks.
- [ ] Prove body vector count and snapshot are unchanged.
- [ ] Run documentation generation/check and `git diff --check`.
