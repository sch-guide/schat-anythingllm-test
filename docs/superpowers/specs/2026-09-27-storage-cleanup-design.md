---
문서종류: 설계
날짜: 2026-09-27
상태: 조회·미리보기 구현 완료, 실제 삭제는 승인 대기
---

# 저장공간 정리 설계

## 목적

같은 PDF를 여러 번 올리면서 남은 예전 페이지 기록, PDF 내부 이미지, 예전 원본 PDF를 관리자가 직접 확인하고 나중에 안전하게 지울 수 있게 합니다. 자동 청소 기능은 아닙니다. 현재 사용 중인 자료는 선택할 수 없습니다.

## 정리 단위

- 페이지 파일 하나가 아니라 업로드 한 번(`document_id`) 단위로 묶습니다. 이 단위에는 페이지 기록, 같은 이름의 이미지 폴더, `sha256(document_id)` 이름의 원본 PDF가 포함됩니다.
- 페이지 기록이 없는 이미지 폴더는 따로 한 단위입니다.
- 어느 업로드에도 연결되지 않는 원본 PDF도 따로 한 단위입니다.
- 화면에는 `document_id`와 파일 경로를 보내지 않습니다. 서버가 만든 해시 키만 사용합니다.

## 분류

| 분류 | 화면 표시 | 조건 | 선택 |
|---|---|---|---|
| A 현재 사용 중 | 사용 중 · 삭제 불가 | 아래 사용 신호 중 하나라도 있음 | 불가 |
| B 예전 업로드 | 삭제 가능 | 페이지 기록이 있고 사용 신호가 전혀 없음 | 가능 |
| C 연결되지 않은 파일 | 삭제 가능 | 페이지 기록이 없는 이미지 폴더이고 사용 신호가 없음 | 가능 |
| D 검토 필요 | 검토 필요 | 한 업로드에 문서 이름이 여러 개, 업로드를 알 수 없는 원본 PDF, 읽을 수 없는 페이지 기록 | 불가 |

사용 신호(하나라도 있으면 보호합니다):

- 작업 공간 문서(`workspace_documents`)로 등록된 페이지
- 그 페이지의 검색 데이터 행(`document_vectors`)
- Chroma 메타데이터에서 해당 `document_id`를 참조함(본문과 이미지 설명 모두)
- 체크리스트가 해당 `document_id`를 참조함
- 현재 작업 공간 문서의 `pdf_images` 경로가 해당 이미지 폴더를 가리킴(관련 이미지·출처 이미지가 쓰는 경로)
- 원본 PDF와 PDF 보기(`pdfRef`)는 현재 작업 공간 문서의 `document_id`로만 찾습니다. 따라서 위 신호로 함께 보호됩니다.

항상 유지하는 것: `document-images/.description-cache`(이미지 설명 저장본). 같은 이미지를 다시 올릴 때 Gemini Vision을 다시 부르지 않기 위해서입니다.

## 삭제 전 미리보기

- `POST /api/schat-admin/storage-cleanup/preview`는 요청할 때마다 현재 데이터를 새로 읽어 다시 분류합니다.
- 선택 항목 중 하나라도 검색 데이터와 연결되어 있으면 전체를 막습니다. 문구는 "현재 검색 데이터와 연결되어 있어 삭제할 수 없습니다."입니다.
- 사용 중·검토 필요·사라진 항목이 있어도 전체를 막습니다.
- 결과에는 삭제 예정 내역과 유지 내역이 들어갑니다.
  - 삭제 예정: 페이지 기록, 이미지 폴더·파일, 예전 원본 PDF, 용량
  - 유지: 현재 문서·페이지, 본문·이미지 설명 벡터, 체크리스트, 현재 원본 PDF, 설명 저장본

## 실제 삭제(다음 단계, 승인 후)

1. 미리보기가 통과한 키만 받습니다. 서버가 다시 미리보기를 실행하고, 통과하지 않으면 중단합니다.
2. 운영 스냅샷 `before`를 저장합니다. 항목은 문서 수, 페이지 수, 본문 벡터, 이미지 설명 벡터, 체크리스트 수, 현재 원본 PDF 수입니다.
3. 대상 파일을 삭제하기 전에 백업 폴더로 먼저 옮깁니다.
   - 대상 파일: 예전 페이지 기록 JSON, 해당 이미지 폴더, 더 이상 참조되지 않는 예전 원본 PDF와 메타데이터
   - Chroma, SQLite, 체크리스트, 설명 저장본은 건드리지 않습니다.
4. `after` 스냅샷을 만들어 `compareOperationalSnapshots(before, after)`로 비교합니다. 하나라도 다르면 백업에서 되돌리고 실패로 기록합니다.
5. Citation, PDF 보기, Automatic 출처는 저장된 과거 답변 1건으로 화면 확인합니다.
6. 매니페스트를 `server/storage/schat-diagnostics/cleanup-manifest-YYYY-MM-DD.json`에 기록합니다.

## 매니페스트 구조

```json
{
  "schema": "schat-storage-cleanup-manifest/1",
  "fileName": "cleanup-manifest-2026-09-27.json",
  "createdAt": "ISO 시각",
  "admin": "실행 관리자 아이디",
  "items": [
    {
      "title": "문서명",
      "kind": "upload | image_folder",
      "documentId": "서버 내부 기록용",
      "pages": 461,
      "pageRecords": 461,
      "imageFolder": "document_id 또는 null",
      "imageFiles": 1584,
      "bytes": 0,
      "originalPdf": true
    }
  ],
  "before": { "documents": 2, "pages": 543, "bodyVectors": 654, "imageVectors": 1331, "checklists": 64, "originals": 2 },
  "after": null,
  "verified": false
}
```

- 병원 원문과 페이지 내용은 기록하지 않습니다.
- 구현 위치: `server/utils/schatAdmin/storageCleanup.js`(`buildCleanupManifest`, `compareOperationalSnapshots`). 현재는 파일로 쓰지 않습니다.
