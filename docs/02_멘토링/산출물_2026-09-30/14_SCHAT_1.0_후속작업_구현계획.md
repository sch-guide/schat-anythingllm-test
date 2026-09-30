# SCHAT 버전 3 후속 작업 구현 계획

> **작업 기준:** `13_SCHAT_1.0_후속작업_설계.md`
> **목표:** 현재 검색·답변 품질을 보존하면서 버전 3 검수, 문서 버전, prompt 기준본, docs_view와 평가 산출물을 완성한다.
> **기술:** Node.js, Prisma/SQLite, React, YAML, Python 문서 생성기, Excel
> **Git:** commit·push·tag를 하지 않는다.

## 공통 중단 조건

- 본문 vector가 654개에서 달라지면 중단한다.
- Hybrid 75:25, Top-K, embedding model 또는 Chroma collection이 달라지면 중단한다.
- current 문서 상태와 무관하게 A8 Top-10이 달라지면 중단한다.
- 관리자 Default System Prompt 값이 달라지면 중단한다.
- 기존 문서·사용자·대화·체크리스트·문제 신고 데이터가 줄면 중단한다.

## 작업 1. 변경 전 기준선과 복구 준비

**파일**

- 생성: `docs/02_멘토링/산출물_2026-09-30/09_문서버전관리.md`
- 생성: Git 제외 로컬 snapshot 파일

**단계**

- [ ] SQLite DB 파일과 Docker volume 위치를 확인한다.
- [ ] 변경 전 DB 사본을 시간표시가 있는 로컬 백업 폴더에 저장한다.
- [ ] 복구 명령과 컨테이너 중지 순서를 문서화한다.
- [ ] 현재 사용자·workspace 문서·vector mapping·체크리스트·신고·FAQ 개수를 기록한다.
- [ ] 본문 vector 654개와 A8 Top-10 snapshot을 저장한다.
- [ ] 관리자 Default System Prompt의 hash만 저장하고 원문을 로그에 출력하지 않는다.

## 작업 2. 범위 밖 질문과 21문항 실제 검수

**파일**

- 생성: `docs/02_멘토링/산출물_2026-09-30/07_SCHAT_1.0_최종검수.md`
- 생성: `docs/02_멘토링/산출물_2026-09-30/08_범위밖질문_평가.md`
- 생성: `docs/02_멘토링/산출물_2026-09-30/로컬전용_원자료/SCHAT_범위밖질문_검증.xlsx`
- 생성: `docs/02_멘토링/산출물_2026-09-30/로컬전용_원자료/SCHAT_간호사_최종검수.xlsx`

**단계**

- [ ] 현재 두 문서의 전체 본문을 로컬에서 확인해 범위 밖 후보 20개를 확정한다.
- [ ] 테스트 직원 계정과 테스트 workspace를 확인한다.
- [ ] 20문항을 Automatic 경로로 질문당 1회 실행하고 응답·근거·점수를 저장한다.
- [ ] 적합·부분적합·부적합을 규칙으로 분류하고 실패 원인을 검색/답변으로 나눈다.
- [ ] A8 21문항을 현재 Automatic 경로로 질문당 1회 실행한다.
- [ ] 답변과 Citation을 검수표에 넣고 사람 입력 칸은 비운다.
- [ ] Excel의 필터·고정 행·줄바꿈·입력 칸과 최종 판정 선택 목록을 확인한다.

## 작업 3. 문서 버전 migration과 공통 current 집합

**파일**

- 수정: `server/prisma/schema.prisma`
- 생성: `server/prisma/migrations/<timestamp>_document_version_registry/migration.sql`
- 생성: `server/models/documentVersion.js`
- 생성: `server/utils/documentVersions/index.js`
- 생성/수정: 관련 model·검색 단위 테스트

**단계**

- [ ] 실패 테스트: 계열에 current가 있으면 current document_id만 반환한다.
- [ ] 실패 테스트: 등록 정보가 없는 기존 workspace는 기존 연결 문서를 모두 허용한다.
- [ ] 실패 테스트: 새 current 지정 시 이전 version은 보존되고 검색 대상에서 빠진다.
- [ ] migration SQL이 기존 표를 삭제·변경하지 않고 새 표만 만드는지 확인한다.
- [ ] DB 백업 뒤 테스트 DB에서 migration과 rollback을 확인한다.
- [ ] 기존 운영 문서 2개를 각각 current로 등록하는 비파괴 bootstrap을 구현한다.
- [ ] 공통 current document 집합 서비스를 구현한다.

## 작업 4. Vector/BM25 공통 version filter

**파일**

- 최소 수정: `server/utils/vectorDbProviders/chroma/index.js`
- 최소 수정: `server/utils/vectorDbProviders/chroma/schatBm25.js` 또는 해당 corpus 입력부
- 수정: 관련 검색 회귀 테스트

**단계**

- [ ] 실패 테스트: Vector와 BM25가 같은 허용 document_id 집합을 받는다.
- [ ] 실패 테스트: old 문서는 양쪽 결과에서 제외된다.
- [ ] 실패 테스트: registry가 없는 기존 상태는 결과가 이전과 같다.
- [ ] 검색 점수·결합 함수·Top-K를 건드리지 않고 후보 입력에만 동일 filter를 적용한다.
- [ ] 변경 전후 A8 전체 Top-10을 비교한다.
- [ ] 차이가 있으면 이후 작업을 중단하고 원인을 보고한다.

## 작업 5. 관리자 문서 버전 표시

**파일**

- 최소 수정: 기존 관리자 문서 endpoint와 문서 목록 component
- 생성/수정: 관리자 UI 회귀 테스트

**단계**

- [ ] API가 문서 계열·version·현재/이전 상태만 공개하고 내부 경로를 숨기는지 테스트한다.
- [ ] 관리자에게 현재 버전과 이전 버전을 묶어 표시한다.
- [ ] 직원용 문서·검색 화면에는 current만 보이는지 확인한다.
- [ ] 기존 원본 PDF 연결, checklist, 이미지 설명 연결이 document_id 기준으로 유지되는지 확인한다.

## 작업 6. 실제 prompt 조사와 YAML 기준본

**파일**

- 생성: 기존 서버 설정 영역 아래 prompt YAML 파일
- 생성: `server/utils/prompts/`의 읽기 전용 loader
- 최소 수정: `server/models/systemSettings.js` 또는 실제 fallback 결정 위치
- 생성: `docs/02_멘토링/산출물_2026-09-30/10_프롬프트_관리.md`
- 수정: prompt 우선순위 테스트

**단계**

- [ ] 실제 Gemini 호출 prompt를 위치·용도·사용 여부·우선순위로 전수 조사한다.
- [ ] 사용자 제공 공식 답변 규칙과 관리자 DB prompt가 같은지 hash/길이로 확인한다.
- [ ] `answer-system.yaml`에 제공된 원문을 글자 변경 없이 저장한다.
- [ ] 실제 사용하는 image description·quiz·evaluator prompt만 YAML화한다.
- [ ] 실패 테스트: workspace prompt가 YAML보다 우선한다.
- [ ] 실패 테스트: 관리자 Default Prompt가 YAML보다 우선한다.
- [ ] 실패 테스트: 둘 다 없을 때만 YAML을 사용한다.
- [ ] 관리자 저장 동작이 YAML을 변경하지 않는지 확인한다.
- [ ] prompt 변경 전후 검색 Top-10이 완전히 같은지 확인한다.

## 작업 7. docs_view 구조도 표시

**파일**

- 수정: `문서도구/문서화면_만들기.py`
- 수정: `검사/문서화면_분리_검사.py`
- 수정: `docs/02_멘토링/산출물_2026-09-30/01_산출물_형식_샘플.md`
- 생성: `docs/02_멘토링/산출물_2026-09-30/11_docs_view_구조도.md`
- 생성: `docs_view/assets/mentoring/*.svg`(자동 생성 결과)

**단계**

- [ ] 실패 테스트: 생성 HTML에 구조도 네 개의 실제 `<img>`가 없다.
- [ ] 생성기가 기존 SVG만 docs_view assets로 복사하게 한다.
- [ ] 문서에서 설명 → 그림 → 접힌 Mermaid 원본 순서를 제공한다.
- [ ] 외부 Mermaid 라이브러리를 추가하지 않는다.
- [ ] docs_view를 생성하고 브라우저에서 네 그림을 확인한다.

## 작업 8. RAGAS·WBS·멘토링 문서

**파일**

- 생성: `docs/02_멘토링/산출물_2026-09-30/12_RAGAS_적용계획.md`
- 수정: `04_SCHAT_1.0_확정_기준.md`, `05_WBS.md`, WBS Excel
- 수정: 멘토링 한눈에 보기·상세근거, `CLAUDE.md`, 현재 상태와 작업일지

**단계**

- [ ] 공식 Gemini 가격을 확인해 21·25·100문항 비용 범위를 계산한다.
- [ ] RAGAS는 실행하지 않고 호출 수와 입력 구조만 기록한다.
- [ ] 평가 우선순위를 사람 정답 → 검색 지표 → 사람 답변 검수 → RAGAS로 기록한다.
- [ ] 멘토링 항목을 `번호. 쉬운 제목`과 완료·진행중·대기로 표시한다.
- [ ] CLAUDE.md에 prompt·version·평가·산출물 위치를 추가한다.

## 작업 9. 전체 회귀와 테스트 웹 확인

- [ ] 서버·frontend 관련 단위 테스트를 실행한다.
- [ ] production build를 실행한다.
- [ ] Docker 세 컨테이너가 healthy인지 확인한다.
- [ ] 테스트 웹환경에만 반영한다.
- [ ] 로그인, 채팅, Citation, PDF viewer, checklist, 이용 가이드, 문제 신고를 실제 화면에서 확인한다.
- [ ] 관리자 prompt 값과 현재 답변 동작이 유지되는지 확인한다.
- [ ] docs_view 구조도 네 개를 실제 화면에서 확인한다.
- [ ] 운영 서버는 변경하지 않는다.
- [ ] 문서 화면 생성·분리 검사와 `git diff --check`를 실행한다.
