---
문서종류: 작업일지
날짜: 2026-09-25
상태: 구현 완료, 실제 출처 재검수 필요
---

# Automatic 선행 검색 context 단순화

## 바꾼 내용

- 병원 문서 관련 질문은 기존 Automatic·AgentHandler 흐름 안에서 `rag-memory`를 사용자 원문 질문으로 먼저 1회 실행합니다.
- 검색 원문은 가짜 function/tool-result 메시지로 만들지 않고, 기존 Gemini 자유형 답변에 전달되는 마지막 사용자 메시지의 병원 문서 context로 붙입니다.
- Gemini context, 답변 아래 출처, 펼쳐 보는 원문과 직접 연결 이미지는 모두 같은 검색 source를 기준으로 만듭니다.
- 검색 source 자체의 text를 사용하므로 별도 배열의 순서를 추정해 다른 문서 원문을 잘못 붙이지 않습니다.
- 검색 결과가 없으면 등록 문서에서 근거를 찾지 못했으며 일반 지식으로 보완하지 말라는 closed-book 안내만 전달합니다.

## 이미지 안전 조건

- source의 직접 `image_key` 또는 직접 검색된 `image_description`의 `image_key`만 허용합니다.
- 같은 페이지 전체 이미지 목록은 사용하지 않습니다.
- 최종 공개 단계에서도 원문 질문으로 초점을 검사해 NRS 질문에 FPRS 이미지가 붙는 일을 막습니다.
- 로고·장식 이미지를 제외하고 출처별 최대 3개만 허용합니다.

## 확인 결과

- 서버 회귀검사 28개와 화면 회귀검사 14개가 통과했습니다.
- frontend production build와 Docker production 이미지 build가 성공했습니다.
- `schat-web`, `schat-chromadb`, `schat-safety-evaluator`가 모두 healthy입니다.
- 승인된 실제 Automatic 요청 5건은 재시도 없이 실행했고 400 오류는 발생하지 않았습니다. 병원 질문 4건은 첫 검색에 원문 질문을 사용했고 날씨 질문은 강제 검색하지 않았습니다.
- 다만 실제 검증용 계측 래퍼가 `rag-memory` handler의 실행 문맥을 보존하지 못해 해당 5건의 검색이 실패했습니다. 따라서 이 실행에서 저장된 출처 0개는 제품 코드의 출처 동작 결과로 판정하지 않으며, 사용자의 재승인 없이는 같은 질문을 다시 전송하지 않았습니다.

## 변경하지 않은 것

- Automatic·AgentHandler와 Gemini 자유형 답변 방식
- system prompt와 Agent 추가 tool calling
- ChromaDB, BM25, Gemini Embedding, 검색 순위와 재색인 상태
- Query 답변과 기존 하단 관련 이미지 호환 경로
- DB schema와 frontend 화면 구조
