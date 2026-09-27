# 데이터 커넥터 제거 설계

## 목표

SCHAT에서 사용하지 않는 데이터 커넥터 UI와 실행 API, collector 구현을 제거한다. PDF 직접 업로드, 단일 URL 직접 등록, 문서 처리, 색인, 검색, 답변, 출처 경로는 유지한다.

## 제거 경계

- 관리 화면의 데이터 커넥터 탭과 GitHub, GitLab, Gitea, YouTube 자막, 웹사이트 대량 수집, Confluence, Drupal Wiki, Obsidian, Paperless-ngx UI를 제거한다.
- 서버의 `/ext/*` 데이터 커넥터 route와 전용 middleware를 제거한다.
- collector의 커넥터 endpoint, loader, connector resync 구현과 전용 테스트를 제거한다.
- YouTube URL을 자막 loader로 우회시키는 처리를 제거한다.
- 커넥터 전용 직접 dependency 선언을 제거한다.

## 보존 경계

- `/process`, `processSingleFile`, PDF loader와 `pdf-parse`를 유지한다.
- `/workspace/:slug/upload-link`, `CollectorApi.processLink`, `collector/processLink`의 일반 URL 처리를 유지한다.
- 단일 URL 문서의 watch/resync에 필요한 `/ext/resync-source-document`, `forwardExtensionRequest`, link resync를 유지한다.
- SQL connector, Telegram external communication connector, Agent Builder WebsiteNode는 별도 기능이므로 유지한다.
- ChromaDB, Gemini embedding, BM25, 검색·근거·답변·출처 코드는 수정하지 않는다.

## 검증

- 테스트를 먼저 변경해 YouTube transcript 우회와 connector watch가 남아 있으면 실패하도록 한다.
- 관리 화면에서 문서 관리만 표시되는지 검증한다.
- connector API가 더 이상 등록되지 않는지 확인한다.
- PDF 처리 및 SCHAT mock 검색·답변·출처 회귀 테스트와 production build를 실행한다.
- 실제 외부 Gemini 호출과 실제 문서/DB 삭제는 하지 않는다.
