# SCHAT 화면 디자인 안내

이 문서는 개발자가 아닌 사람도 SCHAT 화면 구성과 확인 방법을 쉽게 찾도록 정리한 화면 디자인 정본입니다.

VS Code의 쉬운 화면에서 `03_전체_공식문서` 다음에 독립된 `04_화면디자인` 폴더로 표시됩니다.

화면을 실제로 작동시키는 프로그램 파일은 안전한 실행을 위해 `90_개발자용_프로그램파일` 안의 원래 위치에 그대로 둡니다. 이곳에는 무엇을 바꾸려면 어느 파일을 확인해야 하는지 쉬운 말로 설명합니다.

## 로고와 이름

- 왼쪽 메뉴의 `SCHC` 표시와 `SCHAT` 이름은 `frontend/src/components/Sidebar/SchatBrand.jsx`에서 관리함.
- 직원 채팅, 관리자 화면과 모바일 메뉴에 함께 표시함.
- 로고 변경은 검색 결과나 답변 내용에 영향을 주지 않음.

## 글꼴과 다크모드

- 일반 글자는 `Pretendard → Inter → 운영체제 기본 글꼴 → Segoe UI → sans-serif` 순서로 사용함.
- 전역 글꼴은 `frontend/src/index.css`와 `frontend/tailwind.config.js`에서 관리함.
- 코드 블록은 기존 고정폭 글꼴을 유지함.
- 외부 폰트 사이트나 별도 폰트 파일을 사용하지 않음.
- 다크모드 버튼은 `frontend/src/components/WorkspaceChat/ChatContainer/ChatSettingsMenu/DarkMode/index.jsx`에서 관리함.
- 선택한 테마는 브라우저에 저장함.

## 변경 후 확인

1. PC 화면에서 SCHC·SCHAT 표시를 확인함.
2. 모바일 화면에서 로고와 메뉴가 겹치지 않는지 확인함.
3. 밝은 화면과 어두운 화면 전환을 확인함.
4. 관리자에게만 설정 버튼이 보이는지 확인함.
5. 답변, 출처와 관련 이미지 화면이 그대로 표시되는지 확인함.
6. `frontend/src/components/SchatShell.ui.node.test.mjs`를 실행함.
7. frontend production build와 `git diff --check`를 실행함.

## 꼭 알아둘 점

- 이 폴더는 설명서이며 SCHAT 실행 프로그램을 보관하는 곳이 아닙니다.
- 검색, Gemini, ChromaDB, BM25, 로그인, 답변과 출처 기능은 화면 디자인과 별개입니다.
- 실제 프로그램을 수정해야 할 때는 이 문서에 적힌 파일만 먼저 확인합니다.
- 변경 뒤에는 화면 검사와 production build를 실행합니다.
