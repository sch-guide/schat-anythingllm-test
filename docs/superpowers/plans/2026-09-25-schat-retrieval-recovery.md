# SCHAT 문서 등록·검색 복구 구현 계획

> **실행 원칙:** 승인된 7단계를 테스트 우선으로 수행한다. Git commit/tag/push는 하지 않는다.

**목표:** PDF 페이지 일부만 workspace에 등록되는 문제를 막고, 현재 누락된 실무지침서 전체를 안전하게 복구하며, 짧은 한국어 질문의 검색 정확도를 회귀 테스트로 보장한다.

**구조:** 업로드 API가 Collector가 실제 생성한 상대 `docpath`만 공개하고 프런트엔드는 그 정확한 batch를 선택한다. 검색기는 기존 Gemini Embedding + Chroma + BM25 구조와 임계값을 유지하면서 요청 표현, 붙여 쓴 의도, 예시 anchor, 공개 근거 중복, 주제·의도 범위만 정규화한다. 기존 데이터 복구는 최신 완전본 실무지침서 그룹을 staging Chroma collection에 다시 임베딩하고 검증 뒤 SQLite 매핑과 함께 교체하며 이전 collection과 DB 사본을 보존한다.

**기술:** React, Node.js, node:test/Jest, Prisma SQLite, ChromaDB, Gemini Embedding 2, Docker Compose

## 전역 제약

- 검색 모델, ChromaDB, BM25, closed-book, structured response, source ID 검증을 유지한다.
- BM25 coverage `2/3`, standalone vector `0.7`, semantic supplement `0.8` 임계값을 전역 완화하지 않는다.
- 업로드 원본, 로컬 처리 JSON, 계정, 대화, 병원 문서를 삭제하지 않는다.
- Gemini Vision과 답변 생성은 재색인 중 호출하지 않는다. 누락 페이지에 필요한 Gemini Embedding만 사용하며 SDK retry는 0을 유지한다.
- API key, 원문 전체, 내부 ID를 로그·문서·프런트 응답에 노출하지 않는다.
- 현재 작업 트리의 관련 없는 변경을 수정하거나 되돌리지 않는다.
- Git commit, tag, push를 실행하지 않는다.

### 작업 1: 정확한 업로드 batch 선택

**파일**

- 수정: `server/endpoints/workspaces.js`
- 수정: `frontend/src/components/Modals/ManageWorkspace/Documents/UploadFile/FileUploadProgress/index.jsx`
- 수정: `frontend/src/components/Modals/ManageWorkspace/Documents/UploadFile/index.jsx`
- 수정: `frontend/src/components/Modals/ManageWorkspace/Documents/hooks/useDocumentPicker.js`
- 생성: `frontend/src/components/Modals/ManageWorkspace/Documents/hooks/uploadBatchSelection.js`
- 생성: `frontend/src/components/Modals/ManageWorkspace/Documents/hooks/uploadBatchSelection.node.test.mjs`

- [ ] 100개를 넘는 batch와 기존 문서를 분리하는 실패 테스트를 작성한다.
- [ ] 테스트가 기존 `PAGE_SIZE=100` 추정 경로 때문에 실패하는지 확인한다.
- [ ] 서버 응답에 상대 `docpaths`만 추가하고 여러 업로드 완료 결과를 Set으로 합친다.
- [ ] exact batch가 있으면 해당 폴더를 `limit=all`로 해석하되 batch 경로만 선택한다.
- [ ] 구형 응답과 링크 업로드에는 기존 fallback을 유지한다.
- [ ] node 테스트와 frontend production build를 실행한다.

### 작업 2: 한국어 검색과 근거 후보 정밀화

**파일**

- 수정: `server/utils/vectorDbProviders/chroma/schatBm25.js`
- 수정: `server/__tests__/utils/vectorDbProviders/chroma/schatBm25.node.test.js`

- [ ] `대해/대해서/대하여/관해/관하여/대한` 제거 실패 테스트를 작성한다.
- [ ] 기존 의도 suffix로 `수혈종류`, `진정절차`, `수혈준비사항`을 일반 분리하는 실패 테스트를 작성한다.
- [ ] 일반 절차 질문에서 예시·시나리오·CICARE anchor가 제외되며 직접 요청 시 유지되는 실패 테스트를 작성한다.
- [ ] 공개 출처 identity가 같은 후보만 합치고 page/section이 다른 근거는 유지하는 실패 테스트를 작성한다.
- [ ] 직접 주제+의도 근거가 있으면 다른 주제의 목적/절차 근거가 제외되는 실패 테스트를 작성한다.
- [ ] 각 RED를 확인한 뒤 최소 구현하고 전체 BM25/정책 회귀 테스트를 실행한다.

### 작업 3: 안전한 실무지침서 재색인 도구

**파일**

- 수정: `server/utils/vectorDbProviders/chroma/reindexContract.js`
- 수정: `server/__tests__/utils/vectorDbProviders/chroma/reindexContract.node.test.js`
- 생성: `server/scripts/schatRepairGuideIndex.js`

- [ ] 완전한 페이지 집합, 최신 이미지 metadata 그룹 선택, 중복 그룹 거부 계약을 실패 테스트로 작성한다.
- [ ] dry-run에서는 DB/Chroma/API 호출 없이 현재 82+18 상태와 목표 82+461 상태만 요약하게 한다.
- [ ] 실행 모드는 SQLite 사본과 live collection 백업을 먼저 만든다.
- [ ] 검사·시술 문서 vector는 그대로 복사하고 선택한 실무지침서 461페이지를 숫자 page 순으로 staging에 임베딩한다.
- [ ] 이미지 설명은 기존 metadata의 설명문만 보조 vector로 임베딩하며 Vision은 호출하지 않는다.
- [ ] staging의 page/document/vector/mapping 검증 후 collection rename과 Prisma transaction으로 교체한다.
- [ ] 실패 시 live collection과 DB가 원상태가 되도록 rollback한다.

### 작업 4: 실제 데이터 복구와 검증

- [ ] dry-run에서 선택 그룹이 최신 완전본 461페이지이고 이미지 metadata를 가진 그룹인지 확인한다.
- [ ] Gemini Embedding 2, retry 0으로 staging 재색인을 실행한다.
- [ ] workspace 문서가 검사·시술 82 + 실무지침서 461인지 확인한다.
- [ ] p.113, 114, 117~125, 159~163이 Chroma와 workspace mapping에 모두 존재하는지 확인한다.
- [ ] 중복된 실무지침서 공개 근거가 live collection에 남지 않았는지 확인한다.
- [ ] 사용자·대화 수가 변경되지 않았는지 확인한다.

### 작업 5: 질문 회귀와 최종 검증

- [ ] 로컬 retrieval 테스트로 `FPRS`, `수혈 종류/수혈종류`, `수혈 절차`, `진정 목적`, `진정 절차/진정절차`를 확인한다.
- [ ] 제한된 실제 질문을 각 1회만 실행해 근거 페이지와 최종 답변을 확인한다.
- [ ] production build, 관련 서버/프런트 테스트, Docker health, `git diff --check`를 실행한다.
- [ ] 코드·실행 상태 변경을 공식 현재상태·작업일지에 기록하고 `docs_view`를 재생성·검사한다.

