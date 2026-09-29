# docs_view 구조도 표시

## 방식

무거운 Mermaid 런타임을 추가하지 않고, 이미 만들어진 SVG 파일 4개를 `docs_view/assets/mentoring/`으로 복사하여 그림으로 표시합니다.

## 표시 대상

1. 시스템 아키텍처
2. 질문 처리 흐름
3. 문서 등록 DFD
4. 저장 구조 ERD

화면에서는 설명 → 실제 그림 순서로 보입니다. Mermaid 원본 `.mmd`는 개발자가 수정할 수 있도록 그대로 보존합니다.

## 검증

`test_generated_view_shows_four_mentoring_diagrams_as_images` 검사로 4개 그림이 모두 `<img>`로 생성되는지 확인합니다.

산출물 표준 형식은 사용자가 아직 하나를 선택하지 않았으므로 **선택 대기** 상태를 유지합니다.
