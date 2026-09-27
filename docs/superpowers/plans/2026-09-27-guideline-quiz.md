# 지침서 퀴즈 작업 계획 (2026-09-27)

원칙: AI(Gemini)는 관리자 문제 생성·다시 생성에서만 호출한다. 직원 풀이·정답·해설·결과·오답노트는 DB 값만 쓴다.
단계마다 빌드·테스트 통과 후 다음 단계로 간다. 멈출 때는 마지막 통과 단계로 정리한다.

## 0. 현재 구조 조사 결과

- 사용자/권한
  - 역할은 `admin` / `default` 두 가지다.
  - 관리자 API는 `validatedRequest + flexUserRoleValid([ROLES.admin])`로 보호한다.
  - 직원 API는 `validatedRequest`로 보호한다.
  - 부서는 `schat_departments`에 있고, 사용자에 사번이 있다.
- 문서
  - `workspace_documents.metadata`에 document_id, title(예: `2026실무지침서 (26.7).pdf`), page, section, document_version이 있다.
  - 작업 공간은 1개(`schat-2026-09-22`)다.
- 검색
  - Chroma collection 메타데이터에 document_id, page, title, content_type이 있다. 이미지 설명은 content_type이 `image_description`이다.
  - BM25는 `rankByBm25`(schatBm25.js)를 쓴다.
  - production hybrid 검색은 BM25 + vector + RRF 구조다.
- 원본 PDF
  - `originalPdfStatus(documentId)` → pdfRef(HMAC)다.
  - `/workspace/:slug/original-pdf/:pdfRef`는 현재 작업 공간 문서만 열고, Range/206을 지원한다.
- Citation
  - `SourceEvidenceRow({source:{documentName,page,pdfRef,excerpt}, workspaceSlug})`다.
  - PC는 inline PDF, 모바일은 전체 화면(`MobileSourceScreen`)으로 연다.
- Gemini
  - `GeminiLLM.getChatCompletion(messages, {temperature, responseSchema})`다. OpenAI 호환 strict json_schema를 쓴다.
  - 키는 서버 env `GEMINI_API_KEY`에만 있다.
- DB
  - Prisma + SQLite를 쓴다.
  - 컨테이너 entrypoint에서 `prisma migrate deploy`를 실행한다.
- 통계 UI
  - 문제 신고 통계는 Card/InfoRow 목록 방식이다. 차트 라이브러리는 없다.
- 메뉴
  - 직원 사이드바에 `GuideLink`가 있다(데스크톱·모바일 2곳).
  - 관리자 메뉴는 `pages/SchatAdmin/menu.js`에서 관리한다.
- 모바일은 Tailwind `md:` breakpoint와 `isMobile`로 처리한다.
- 다크모드는 기본이 dark이고 `light:` variant를 쓴다. 관리자 화면은 theme 변수를 쓴다.

## 체크리스트

### 1단계: 저장 구조·생성·검토·공개·풀이

- [x] 0 구조 조사
- [x] 1 직원 메뉴 `지침서 퀴즈`, 책+체크 outline 아이콘
- [x] 2 SCHAT 디자인 언어(흰 카드·블루·둥근 모서리)
- [x] 3 상단 헤더·설명, 개발 용어 미노출
- [x] 4 직원은 저장된 문제만, 생성 불가
- [x] 5 필터(문서·주제·문항 수·난이도·유형) → 퀴즈 시작(DB만)
- [x] 6 문제 화면(진행률·선택지·이전/정답 확인/다음)
- [x] 7 정답 확인(정답/오답·정답 선택지·해설·출처, DB값)
- [x] 8 해설 및 근거 + 근거 원문 보기(기존 Citation 재사용)
- [x] 9 문제 데이터 필드 전부 저장
- [x] 10 퀴즈 세트
- [x] 11 Gemini는 관리자 생성에서만
- [x] 12 관리자 메뉴 `퀴즈 관리`(문제 신고 다음)
- [x] 13 문제 생성 입력 화면
- [x] 14 문서 전체 전송 금지, 검색 근거만 전달
- [x] 15 생성 원칙 prompt
- [x] 16 구조화 JSON(strict schema)
- [x] 17 생성 결과는 작성중, 관리자 공개 필요
- [x] 18 관리자 수정(출처 page 존재 검증)
- [x] 19 원문 확인(기존 PDF viewer)
- [x] 20 다시 생성(이때만 Gemini)
- [x] 21 저장·재사용
- [x] 22 랜덤 출제
- [x] 32 객관식 4지선다·OX만
- [x] 33 난이도 초급/중급/고급
- [x] 34 관리자 탭(문제 목록·퀴즈 세트·문제 생성·통계), 목록 검색/필터
- [x] 35 공개/사용중지, 관리자 완전삭제
- [x] 37 AI 사용 안내 + 오늘 AI 문제 생성 N회
- [x] 38 Gemini 호출을 QuizGenerationService 하나로 제한(구조 분리 + 테스트)
- [x] 39 생성 실패 안내, 기존 퀴즈 정상
- [x] 40 키 재사용·미노출·미저장
- [x] 41 모바일 세로 배치, 기존 모바일 원문 UX
- [x] 42 다크모드
- [x] 43 실제 사용 흐름
- [x] 44 관리자 브라우저 E2E
- [x] 45 직원 브라우저 E2E
- [x] 46 직원 과정 Gemini 0회 검증
- [x] 47 기존 기능 보호
- [x] 48 완료 보고
- [x] B 선택지 순서 섞어도 선택지 id 기준 판정, OX 별도 형식
- [x] C 문제 수 부족 시 안내 후 있는 만큼 진행

### 2단계: 점수·기록·결과·오답노트

- [x] 23 최근 푼 문제 덜 출제(DB)
- [x] 24 현재 점수·정답률
- [x] 25 본인 최근 퀴즈 기록
- [x] 26 결과 화면(틀린 문제 다시 보기·다시 풀기·종료)
- [x] 27 오답노트
- [x] 28 틀린 문제 다시 보기

### 3단계: 통계·버전

- [x] 29 문항별 정답률·자주 틀리는 문항
- [x] 30 부서별 평균 점수·정답률·많이 틀린 주제(순위표 없음)
- [x] D 응답자 5명 미만 부서는 평균 미표시
- [x] 31 직원 본인 결과만 조회
- [x] 36 문서 버전 저장, `이전 문서 기반` 표시

### 공통

- [x] A 정식 Prisma migration(새 테이블만), 배포 순서·백업 안내
- [x] 시작 전 DB 백업(server/storage/anythingllm.before-quiz-20260927.db)
- [x] 문서 현행화(docs/00_현재상태, 01_작업일지, docs_view)

## 설계 요약

- 테이블(새로 추가만)
  - `schat_quiz_sets`
  - `schat_quiz_questions`
  - `schat_quiz_attempts`
  - `schat_quiz_answers`
  - `schat_quiz_wrong_notes`
  - `schat_quiz_generation_logs`
  - 기존 `users` 테이블은 바꾸지 않는다. Prisma schema에 back-relation 필드만 추가하며 DB 컬럼 변경은 없다.
  - 사용자 삭제 시 본인 풀이 기록은 CASCADE, 생성자·수정자 연결은 SET NULL이다.
- 정답 저장
  - 객관식: `choices`=[{id:"c1".."c4", text}], `correct_choice_id`로 저장하고 선택지 id로 판정한다. 표시 순서는 풀이마다 섞는다.
  - OX: `choices` 없음, `correct_ox`="O"|"X".
- 모듈 분리
  - `utils/schatQuiz/bank.js`: DB·출제·채점. AI import 없음.
  - `utils/schatQuiz/generation.js`: QuizGenerationService. 검색 근거 수집과 Gemini 호출을 여기서만 한다.
  - `endpoints/schatQuiz.js`: 직원·관리자 공통 조회. bank만 import한다.
  - 관리자 생성 endpoint만 generation을 불러온다.
- 근거 수집
  - Chroma collection에서 선택 문서(document_id)의 본문 chunk만 가져온다. 이미지 설명은 AI가 만든 글이라 제외한다.
  - 주제로 기존 `rankByBm25` 순위를 매긴다(외부 호출 없음).
  - 상위 쪽 근거만(최대 약 12,000자) Gemini에 보낸다.
