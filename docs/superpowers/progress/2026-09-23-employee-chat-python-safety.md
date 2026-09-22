# 직원 채팅 Python 안전검사 연결 진행 기록

## 완료 항목

- 일반 직원 채팅에서 Gemini 후보를 브라우저로 보내기 전에 Python 안전검사를 실행하도록 연결
- 검사 통과 시에만 후보 표시
- 실패·오류·시간초과 시 원문 기반 대체 답변 사용
- 대체 답변도 만들 수 없으면 답변 중단
- 숫자·단위·시간·조건·예외·부정·금기·행위 종류·행위 강도·근거 연결 검사 재사용
- 직원 화면 출처를 문서명·페이지·항목명으로 제한
- 내부 안전검사 Docker 서비스 추가 및 외부 포트 비공개
- ChromaDB 재시작 후 데이터 유지 확인

## 주요 변경 파일

- `safety_evaluator/core.py`
- `safety_evaluator/service.py`
- `server/utils/schatSafety/`
- `server/utils/chats/stream.js`
- `server/utils/vectorDbProviders/chroma/`
- `docker/docker-compose.yml`
- `docker/safety-evaluator.Dockerfile`

## 테스트 결과

- Python 안전검사 집중 테스트: 14건 통과
- Node.js 안전 게이트 및 서비스 왕복 검사: 통과
- BM25 보완 검색 검사: 4건 통과
- 기존 SCHAT 전체 검사 중 1,045건 통과, 2건 제외
- 기존 진정간호 기준선 1건은 기존 상태와 동일하게 별도 실패

## 다음 단계

1. 제한된 직원 계정으로 로그인 화면 직접 검수
2. 승인된 비민감 문서로 실제 Gemini 후보의 통과·대체 흐름 확인
3. 실제 문서의 페이지·항목명 메타데이터 품질 확인

## 보류 항목

- 정식 운영 승인
- 기존 진정간호 UAT 31/36 기준선 문제 해결
- 독립 저장소만 복제했을 때 Python 원본 코드 위치를 제공하는 배포 패키징

## 중단 조건 확인

- 안전검사 완화 없음
- Gold·fixture·DB schema 변경 없음
- 외부 Gemini 호출 없음
- 병원 원문 또는 개인정보의 신규 외부 전송 없음
- Git commit·tag·push 없음
