# 관리자 청크 조회 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 승인된 사용자 설계를 현재 작업공간에서 실행함.

**Goal:** 관리자가 문서별 검색 조각과 과거 답변 근거를 읽기 전용으로 확인함.

**Architecture:** 별도 관리자 GET API와 조회 서비스, 관리자 화면을 추가함. 현재 Chroma 조각과 저장된 답변 출처를 구분하며 이전 자료를 현재 자료로 바꾸거나 재색인하지 않음.

**Tech Stack:** Node CommonJS, Express, Prisma 읽기, Chroma 읽기, React, node:test.

**Spec:** 사용자가 승인한 6단계: 문서별 청크 목록·내용·키워드 검색, 직원 질문 기록에서 근거 바로 보기, 문서·페이지·등록 버전·이전 버전 표시, 관리자 전용 조회만 제공.

## Global Constraints

- 기존 미완성 변경 보존. 운영 데이터·DB 구조·검색 비율·직원 기능 변경 금지.
- 실제 Gemini 호출 금지. 가짜 자료만 테스트. push 금지.
- 파일 경로를 사용자에게 받아 읽지 않음. 관리자 인증·작업 공간 범위를 서버에서 확인함.
- 청크 수정·삭제 API 없음. 임베딩 생성이나 Chroma collection 생성 없음.
- 정보가 없으면 확인 불가로 표시. 저장된 출처 발췌를 전체 원본 청크라고 속이지 않음.
- 단계 완성 후 주 담당자가 이 단계 파일만 커밋함. 다른 미커밋 기능 전체를 포함하지 않음.

### Task 1: 읽기 전용 서버와 관리자 화면

**Files:** 새 server/utils/schatAdmin/chunkViewer.js, server/endpoints/chunkViewer.js, 관련 node 검사. 새 frontend/src/models/chunkViewer.js, pages/SchatAdmin/sections/Chunks.jsx 및 검사. 기존 server/index.js, 관리자 menu/index/SettingsSidebar에 최소 연결. 기존 질문 통계 화면에 연결 필요 시 추가 변경만 별도 패치로 남김.

**Interfaces:** GET /schat-admin/chunks?workspaceId=&documentId=&q=&offset=, GET /schat-admin/chunk-chats?workspaceId=&offset=, GET /schat-admin/chunk-chats/:id?workspaceId=. 서버는 한 번에 최대 50개와 다음 페이지 여부 반환. 문서 선택 목록은 GET /schat-admin/chunk-documents?workspaceId=.

- [ ] 기존 문서·vector id·답변 source 저장 구조를 읽고 조회 전용 연결을 설계함. 버전의 명시 metadata를 우선하고 없으면 등록 시각/확인 불가로 표시함.
- [ ] 가짜 collection.get/prisma를 사용하는 실패 검사부터 작성함. 직원/manager 차단, 다른 workspace chat 차단, 문서 선택·검색·페이지 이동·빈 값·실패 안내·이전 출처·정보 없는 버전 검증함.
- [ ] 조회 서비스와 API 구현함. 같은 workspace 문서 id로 범위를 제한하고 출력 metadata는 허용 필드만 반환함. 읽기 크기와 검색 처리에 상한을 둠.
- [ ] 관리자 ‘검색 조각 조회’ 메뉴에 문서별/질문별 조회를 제공함. 질문을 누르면 저장된 근거 확인, 이전 버전 또는 원본 확인 불가를 명시함. HTML 원문을 실행하지 않고 텍스트로 표시함.
- [ ] 자동 검사·Vite build·코드 검토 후 주 담당자가 문서 갱신·선별 커밋함.

### 다음 단계

6단계 검증·커밋 후에만 7단계 seed/temperature 조사와 구현을 시작함. 실제 동일 질문 호출은 최대 5회이며 자동 재시도로 한도를 넘기지 않음.
