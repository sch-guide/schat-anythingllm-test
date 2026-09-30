# SCHAT

SCHAT은 AnythingLLM을 기반으로 만든 병원 실무지침 AI 시스템임. 관리자가 등록한 병원 지침과 교육자료에서 근거를 찾아 직원에게 답변, 출처와 원본 PDF를 제공함.

처음 보는 사람은 [SCHAT 처음 읽기](00_읽어보기.md)를 확인함.

## 핵심 문서

- [현재 프로젝트 상태](docs/00_현재상태/현재_프로젝트_상태.md)
- [SCHAT 공식 버전 체계](docs/00_현재상태/SCHAT_버전_체계.md)
- [멘토링 이행 현황](docs/02_멘토링/2026-09-19_멘토링_한눈에_보기.md)
- [평가와 검색 기준](docs/02_멘토링/평가와_검색_기준.md)
- [운영 인수인계](05_인수인계/SCHAT_인수인계.md)

## 프로그램 폴더

`frontend`, `server`, `collector`, `docker`, `schat-core`, `safety_evaluator`와 `server/storage`는 실행·배포 경로이므로 이름이나 위치를 바꾸지 않음.

## 안전

- `.env`, API 키, 비밀번호와 토큰을 Git에 올리지 않음.
- 운영 DB, Chroma volume, 등록 문서와 원본 PDF를 승인 없이 삭제하지 않음.
- 프로그램 변경은 로컬 검사와 테스트 환경을 거친 뒤 운영에 반영함.

AnythingLLM 원저작권과 사용조건은 `LICENSE`, `TERMS_SELF_HOSTED.md`와 `SECURITY.md`를 따름.
