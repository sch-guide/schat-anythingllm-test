# SCHAT 원본 PDF Citation 설계

## 목표

관리자가 PDF를 등록하면 검색용 처리 결과와 별개로 원본 PDF를 한 번만 보존한다. Citation의 `근거 원문 보기`는 해당 PDF의 실제 페이지를 우선 표시하고, PDF를 열 수 없을 때만 기존 excerpt로 돌아간다.

## 저장과 식별

- 원본은 `server/storage/original-documents` 아래에 영구 저장한다.
- 저장 파일명은 `document_id`의 SHA-256를 사용해 경로 조작을 차단한다.
- `pdfRef`는 저장 영역의 전용 비밀키와 `document_id`로 만든 HMAC이다. 직원 응답에는 `document_id`와 실제 경로를 넣지 않는다.
- 같은 `document_id`에 같은 파일을 다시 연결하면 no-op로 처리하고, 내용이 다른 PDF는 충돌으로 거부한다.

## 관리자 흐름

- 새 PDF 업로드: 서버가 `document_id`를 먼저 생성해 원본을 보존한 뒤, 같은 ID를 기존 collector에 전달한다. 처리가 실패하면 이번 요청이 새로 만든 원본만 정리한다.
- 기존 PDF: 원본 PDF 행에서 `원본 PDF 연결`을 누르고 PDF만 선택한다. 검색 JSON, workspace document, Chroma, BM25는 변경하지 않는다.

## 조회와 Citation

- PDF API는 로그인과 workspace 접근 권한을 확인한 뒤, 해당 workspace의 문서 metadata에서 `pdfRef`를 다시 검증한다.
- API는 `application/pdf`, `inline`, `Accept-Ranges: bytes`를 사용하고 단일 byte range를 지원한다.
- frontend는 인증 헤더로 PDF blob을 받아 object URL을 만든 후 `#page=<page>`로 브라우저 PDF viewer에 연다.
- PDF가 정상 표시되면 Citation 내부의 별도 related image는 숨긴다. PDF가 없거나 로드에 실패하면 기존 excerpt와 related image를 그대로 표시한다.

## 비범위

Automatic, AgentHandler, rag-memory, BM25, Chroma 검색, Gemini, image description, 본문 벡터와 excerpt 데이터는 변경하지 않는다.
