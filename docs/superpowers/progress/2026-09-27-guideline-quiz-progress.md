# 지침서 퀴즈 진행 기록

계획: `docs/superpowers/plans/2026-09-27-guideline-quiz.md`

## 1단계 완료 (저장 구조·생성·검토·공개·풀이)

- 완료 항목: 0~22, 32~35, 37~47(1단계 범위), B, C, 시작 전 DB 백업
- 변경 파일
  - server
    - `prisma/schema.prisma`: 새 모델 6개와 users back-relation. users 테이블 자체는 변경하지 않았다.
    - `prisma/migrations/20260927030000_schat_guideline_quiz/`: CREATE TABLE/INDEX만 있다.
    - `utils/schatQuiz/{core,bank,generation}.js`
    - `endpoints/schatQuiz.js`, `endpoints/schatQuizGeneration.js`, `index.js`
    - 테스트: `__tests__/utils/schatQuiz/quiz.node.test.js`
  - frontend
    - `models/schatQuiz.js`, `components/SchatQuiz/*`, `pages/Quiz/*`
    - `pages/SchatAdmin/sections/{Quiz,QuizReview,QuizStats,quizLabels}`
    - `menu.js`, `index.jsx`, `SettingsSidebar`(메뉴 아이콘), `Sidebar`, `main.jsx`, `paths.js`
    - `schatAdmin.node.test.mjs`(메뉴·사이드바 기대값)
- 테스트 결과: 서버 263/263, 화면 119/119, Docker 빌드 정상, migration 적용 정상
- 브라우저 E2E
  - 관리자: 생성 2회(객관식 10, OX 5), 원문 확인(PDF p.113), 없는 쪽 저장 거부, 수정·되돌림, 공개
  - 직원: 7문항 부족 안내, 선택지 섞음 후 id 판정, 해설·출처·PDF, OX, 모바일, 다크
  - 직원 과정 Gemini 호출 0회(2 → 2)
- 다음 단계: 2단계(23~28) 점수 카드·결과·기록·오답노트
- pending: 퀴즈 세트 상태 자동 공개(코드 반영, 2단계 빌드에서 확인)
- 중단 조건: 없음

## 2단계 완료 (점수·기록·결과·오답노트)

- 완료 항목: 23~28
- 테스트: 화면 120/120, Docker 정상
- 브라우저: 점수 카드·결과·다시 풀기·오답노트(자동 저장, 맞히면 빠짐)·틀린 문제 다시 보기·최근 기록·모바일·다크를 확인했다. Gemini 0회.

## 3단계 완료 (통계·버전)

- 완료 항목: 29, 30, 31, 36, D
- 추가: 생성 서비스 실패 테스트(429 → 안내문, 근거 없음 → AI 미호출). 테스트는 실제 DB에 쓰지 않는다(live/log 주입).
- 테스트: 서버 267/267, 화면 121/121
- 브라우저
  - 통계(밝은·어두운 화면), 부서 5명 미만 미표시를 확인했다.
  - 다시 생성은 Gemini 1회였다.
  - 공개하면 세트가 자동으로 공개됐다.
- 정리
  - 테스트로 공개한 문제 13개와 세트는 작성중으로 되돌렸다.
  - T90001은 다시 사용중지했다.
  - 세션과 스크린샷은 삭제했다.
- 중단 조건: 없음. 전체 완료.

