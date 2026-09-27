# Data Connectors Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unused data-connector feature while preserving direct document and single-URL ingestion and the SCHAT RAG path.

**Architecture:** Remove connector-only UI, public server routes, collector loaders, resync handlers, and direct dependencies. Keep shared file processing and generic URL processing, reducing live sync to generic link documents only.

**Tech Stack:** React, Express, Node.js collector, Jest, Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-25-data-connectors-removal-design.md`

## Global Constraints

- Do not change PDF upload, Gemini embedding, ChromaDB, BM25, search, answer, or source behavior.
- Do not reindex, migrate, delete documents, or call Gemini.
- Do not commit, tag, or push.

---

### Task 1: Lock the removal behavior with tests

**Files:**
- Modify: `collector/__tests__/processLink/convert/generic.test.js`
- Modify: `server/__tests__/models/documentSyncQueue.test.js`

- [ ] Change the YouTube test to require generic web processing without the transcript loader.
- [ ] Add watchability assertions that accept `link://` and reject connector source schemes.
- [ ] Run both tests and confirm they fail for the old behavior.

### Task 2: Remove frontend entry points

**Files:**
- Modify: `frontend/src/components/Modals/ManageWorkspace/index.jsx`
- Modify: `frontend/src/models/system.js`
- Delete: `frontend/src/components/Modals/ManageWorkspace/DataConnectors/`
- Delete: `frontend/src/components/DataConnectorOption/`
- Delete: `frontend/src/media/dataConnectors/`
- Delete: `frontend/src/models/dataConnector.js`

- [ ] Remove the tab, connector model exposure, components, and assets.
- [ ] Verify the management modal renders document management directly.

### Task 3: Remove server and collector connector execution

**Files:**
- Modify: `server/index.js`
- Modify: `server/models/documentSyncQueue.js`
- Modify: `server/jobs/sync-watched-documents.js`
- Delete: `server/endpoints/extensions/index.js`
- Delete: `server/utils/middleware/isSupportedRepoProviders.js`
- Modify: `collector/extensions/index.js`
- Modify: `collector/extensions/resync/index.js`
- Modify: `collector/processLink/convert/generic.js`
- Modify: `collector/processLink/helpers/index.js`
- Delete: connector loaders and connector-only tests under `collector/`

- [ ] Unregister public connector routes.
- [ ] Retain only generic link resync and watch support.
- [ ] Remove YouTube transcript dispatch and connector implementations.
- [ ] Run focused collector and server tests until green.

### Task 4: Remove direct dependencies and verify the pipeline

**Files:**
- Modify: `collector/package.json`
- Modify: `collector/yarn.lock`
- Update: project status and dated work log under `docs/`

- [ ] Remove connector-only direct dependencies and refresh the lockfile.
- [ ] Run frontend and production Docker builds.
- [ ] Run PDF/document, SCHAT search, structured-answer, and source regression tests without external calls.
- [ ] Regenerate `docs_view` and run documentation separation tests.
- [ ] Review `git diff --stat`, `git diff --check`, and deleted paths for accidental shared-code removal.
