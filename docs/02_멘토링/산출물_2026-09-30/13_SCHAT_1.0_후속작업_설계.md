# SCHAT 버전 3 후속 작업 설계

> 작성일: 2026-09-29
> 목적: 현재 검색과 답변 동작을 보존하면서 버전 3 검수, 문서 버전 관리, 프롬프트 기준본, 문서 화면과 평가 산출물을 정리한다.

## 1. 변경하지 않는 기준

- Vector 검색, BM25 계산, Hybrid 75:25 결합을 변경하지 않는다.
- 검색 후보 수, 점수, embedding 모델과 query embedding을 변경하지 않는다.
- 동의어·띄어쓰기·source filter·Citation filter와 dedup을 변경하지 않는다.
- Automatic, AgentHandler, rag-memory와 답변 생성 순서를 변경하지 않는다.
- Chroma collection을 초기화하거나 문서를 재색인하지 않는다.
- 관리자 화면에 저장된 `SCHAT 기본 답변 규칙`을 수정하거나 덮어쓰지 않는다.
- 운영 서버에는 배포하지 않고 Git commit·push·tag를 하지 않는다.

## 2. 현재 기준선

| 항목 | 기준 |
|---|---:|
| 본문 vector | 654개 |
| Vector Hit@10 / MRR | 100% / 0.743 |
| BM25 Hit@10 / MRR | 71.4% / 0.560 |
| Hybrid Hit@10 / MRR | 100% / 0.738 |
| Hybrid 비율 | Vector 75% + BM25 25% |

코드 변경 전 대표 질문의 Top-10 문서·쪽·점수와 Citation을 저장하고, 변경 뒤 같은 입력으로 비교한다. 문서 버전 필터를 도입하더라도 현재 두 문서가 모두 current이면 결과가 같아야 한다.

## 3. 작업 단위

### 3.1 범위 밖 질문 검수

1. 현재 등록된 두 문서의 제목·목차·본문 조각을 로컬에서 확인한다.
2. 실제 병원 업무 질문 중 문서에 답이 없는 후보를 만든다.
3. 모든 본문 조각에서 질문의 정답 내용이 없음을 다시 확인해 20개를 확정한다.
4. 테스트 직원 계정으로 현재 Automatic 경로에 각 질문을 정확히 한 번 전송한다.
5. 검색 근거·점수·최종 답변·추측 여부를 기록한다.
6. 실패가 있어도 prompt나 검색을 자동 수정하지 않고 검색 문제와 답변 문제를 나눠 기록한다.

목표는 근거 없는 질문 20/20에서 문서 밖 추측 0건이다.

### 3.2 기존 21문항 답변 검수

- A8의 현재 질문과 문서명·쪽 정답을 사용한다.
- 예전 답변을 재사용하지 않고 현재 Automatic 경로에서 각 질문을 한 번 실행한다.
- SCHAT 답변과 실제 표시 출처를 Markdown과 Excel에 넣는다.
- 간호사가 입력할 여섯 칸은 비워 두고 최종 판정을 대신하지 않는다.

### 3.3 문서 버전 관리

문서 버전 정보는 운영 DB에 별도 표로 저장한다. 검색 vector나 기존 문서 metadata를 다시 만들지 않는다.

개념:

- 문서 계열: 같은 지침서의 여러 버전을 묶는 공개 관리 단위
- 문서 버전: `document_id`, version, 업로드 시각, current 여부
- 교체 관계: 이전 문서가 어떤 현재 문서로 대체됐는지 기록

동작:

1. 기존 DB 파일을 복사해 백업하고 복구 명령을 문서화한다.
2. 기존 운영 문서 두 건을 각각 독립 계열의 current로 등록한다.
3. 같은 계열의 새 버전을 current로 정하면 이전 버전은 보관하되 검색 대상에서 제외한다.
4. 공통 서비스가 workspace에서 현재 사용 가능한 `document_id` 집합을 반환한다.
5. Vector와 BM25가 같은 집합만 후보로 사용한다.
6. 관리자 화면에는 계열별 현재·이전 버전을 표시하고 직원에게는 current만 공개한다.

안전 조건:

- 이전 문서를 삭제하지 않는다.
- 사용자·대화·문제 신고·FAQ·체크리스트 데이터를 건드리지 않는다.
- current 상태가 아직 등록되지 않은 기존 workspace는 기존 검색과 동일하게 모든 연결 문서를 허용하는 호환 fallback을 둔다.
- version filter 적용 뒤 후보가 부족하다는 이유로 검색 범위를 구버전까지 자동 확대하지 않는다.

### 3.4 프롬프트 기준본

실제 사용 중인 prompt를 전수 조사하되 실제 사용하는 것만 YAML 기준본으로 만든다.

우선순위:

1. workspace 전용 prompt
2. 관리자 화면의 Default System Prompt
3. YAML 기준본
4. 코드의 마지막 fallback

`answer-system.yaml`에는 사용자가 제공한 현재 공식 답변 규칙을 글자 변경 없이 저장한다. 관리자 DB 값이 있으면 YAML은 읽히더라도 답변을 덮어쓰지 않는다. YAML은 검색이 끝난 뒤 답변 prompt를 결정하는 곳에서만 fallback으로 사용한다.

체크리스트는 현재 규칙 기반이므로 checklist prompt 파일을 만들지 않는다. 이미지 설명, 퀴즈, evaluator 등은 실제 호출 경로와 중복 여부를 확인한 뒤 사용 중인 prompt만 분리한다.

각 YAML에는 `version`, `name`, `updated_at`, `reason`, `prompt`를 둔다. 초기 구현은 시작 시 읽는 방식으로 하고 runtime reload는 추가하지 않는다. 기준본 변경 반영에는 container restart가 필요하며, 관리자 override가 있으면 재시작해도 운영 prompt는 바뀌지 않는다.

### 3.5 docs_view 구조도

- Mermaid 런타임 라이브러리를 추가하지 않는다.
- 기존 SVG 네 개를 생성기가 `docs_view/assets/mentoring/`으로 복사한다.
- 산출물 설명 뒤에 실제 SVG 그림을 `<img>`로 표시한다.
- Mermaid 원본은 접힌 `원본 보기` 영역으로 제공한다.
- 산출물 표준 형식은 계속 `선택 대기`로 둔다.

### 3.6 RAGAS 계획

RAGAS는 실행하지 않는다. 질문, retrieved contexts, 현재 답변, 사람 기준 답안, Gemini evaluator가 필요한 구조와 21·25·100문항 예상 호출 수 및 비용만 기록한다. 평가는 다음 순서를 유지한다.

1. 간호사가 정한 문서·쪽
2. Hit@10 / MRR
3. 간호사 답변 검수
4. RAGAS 보조 평가

## 4. 산출물

기존 파일을 지우지 않고 다음을 추가하거나 갱신한다.

- `07_SCHAT_1.0_최종검수.md`
- `08_범위밖질문_평가.md`
- `09_문서버전관리.md`
- `10_프롬프트_관리.md`
- `11_docs_view_구조도.md`
- `12_RAGAS_적용계획.md`
- `로컬전용_원자료/SCHAT_간호사_최종검수.xlsx`
- `로컬전용_원자료/SCHAT_범위밖질문_검증.xlsx`

답변·검색 근거가 포함된 Excel은 기존 Git 제외 폴더에만 둔다.

## 5. 검증 순서

1. 변경 전 DB·vector 수와 대표 Top-10 snapshot 저장
2. 실패 테스트 작성 및 실패 확인
3. 문서 버전 migration과 공통 current document 서비스 구현
4. Vector/BM25가 같은 current 집합을 사용하는지 단위 테스트
5. prompt YAML loader와 우선순위 테스트
6. 관리자 prompt가 YAML보다 우선하는지 확인
7. docs_view SVG 표시 테스트
8. 기존 A8 21문항 검색 재평가와 Top-10 비교
9. 서버·frontend 관련 회귀 테스트와 production build
10. Docker 세 서비스 healthy 확인
11. 테스트 웹화면에서 관리자 문서 버전, prompt fallback, 구조도 확인
12. 기존 채팅·Citation·PDF·체크리스트·이용 가이드·문제 신고·로그인 확인
13. 문서와 docs_view 갱신 후 `git diff --check`

## 6. 중단 조건

다음 중 하나라도 발생하면 범위를 넓혀 고치지 않고 원인을 먼저 보고한다.

- 본문 vector 654개 또는 Chroma collection이 변경됨
- A8 Top-10이 문서 버전 상태와 무관하게 달라짐
- Hybrid 75:25가 달라짐
- 관리자 prompt가 자동 변경됨
- 기존 문서·사용자·대화·체크리스트 데이터가 줄어듦
- 운영 서버 변경이 필요함
