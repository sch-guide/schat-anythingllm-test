---
문서종류: 작업일지
상태: 완료
---

# 직원 답변 경로에서 Python 안전검사 Gate 분리

## 목표

현재까지 개선한 Gemini Embedding 2, ChromaDB 116개 벡터, BM25 보완 검색, 질문별 직접 근거 선택, 절차 연속 근거, closed-book 원칙과 출처 표시를 유지하면서 직원 실제 답변 경로의 Python 안전검사 Gate만 기본적으로 끕니다.

## 변경 결과

- `SCHAT_SAFETY_ENABLED=true`는 유지했습니다.
- `SCHAT_SAFETY_GATE_ENABLED=false`를 현재 테스트 웹 기본값으로 추가했습니다.
- Gate OFF 경로는 `검색 근거 → Gemini structured response → JSON·허용 출처 ID 확인 → 직원 화면` 순서입니다.
- Python `/prepare`, `/validate`, PASS/FAIL 판정과 임상 validator 실패 시 원문 기반 대체 답변은 Gate OFF 직원 경로에서 호출하지 않습니다.
- Python 안전검사 서비스, 코드와 기존 검사는 삭제하지 않았습니다. Gate ON 경로도 보존했습니다.
- 근거 0건은 채팅 모드와 관계없이 Gemini 답변 생성 전에 `등록된 병원 지침에서 관련 근거를 확인할 수 없습니다.`로 중단합니다.
- ChromaDB 재색인은 실행하지 않았고 116개 벡터를 그대로 확인했습니다.

## 실제 질문 검수

세 질문을 각각 한 번만 실행했습니다.

| 질문 | 결과 | 사용 근거 |
|---|---|---|
| 수혈 절차 알려줘 | 다섯 단계의 자연스러운 Gemini 절차 답변 표시, Python safety 결과와 fallback 없음 | `2026실무지침서 (26.7).pdf` p.117 `수혈 절차`, p.124 `수혈 직전 환자 확인` |
| 진정 절차 알려줘 | 여덟 단계의 자연스러운 Gemini 절차 답변 표시, Python safety 결과와 fallback 없음 | 같은 문서 p.160 `의사가 작성한 진정 전 환자평가서 확인 방법`, p.161 `진정 중 서면 기록지 출력 방법` |
| 비터널형 카테터는 뭐야? | 검색 근거 0건 안내 후 중단, Gemini 일반지식 답변 없음 | 없음 |

세 답변 모두 내부 ID, `document_metadata`, SVG 문자열을 화면에 노출하지 않았습니다.

## 자동검사

- Gate OFF mock·structured·화면 정리·Gate ON 보존 관련 Node 검사: 34개 통과
- 검색·BM25·근거 선택·재색인 계약 Node 검사: 36개 통과
- 보존된 Python 안전검사: 51개 통과
- JavaScript 구문 검사와 Docker Compose 설정 검사 통과
- 웹·ChromaDB·Python 안전검사 컨테이너 모두 healthy

이 결과는 기능 비교 테스트 결과이며 정식 운영 승인으로 간주하지 않습니다.
