# 이미지 설명 전체 보충 및 증분 처리 설계

## 목표

기존 저장 이미지 중 설명이 없는 고유 SHA-256 hash만 Gemini Vision으로 설명하고, 앞으로 PDF를 등록할 때도 새 hash만 자동 처리한다. 기존 본문 벡터와 검색·답변·화면 경로는 변경하지 않는다.

## 공통 처리 규칙

- 이미지의 SHA-256 hash를 유일 키로 사용한다.
- 성공 cache가 있으면 설명을 재사용하고 Gemini를 호출하지 않는다.
- 빈 응답과 실패도 상태 cache에 기록해 같은 hash를 자동 재호출하지 않는다.
- 기존 `{ imageKey, description }` cache는 성공 기록으로 계속 읽는다.
- batch 기본 크기는 50이며 각 batch 완료 후 진행상태를 원자적으로 저장한다.
- 한 이미지 실패는 다른 이미지와 PDF 본문 처리를 중단하지 않는다.
- 로그에는 API key, 이미지 경로, 병원 원문을 기록하지 않는다.

## 전체 backfill

dry-run은 workspace에 등록된 이미지 metadata, 설명 cache, Chroma의 이미지 설명 벡터를 대조한다. 고유 이미지가 1,172개를 초과하거나 신규 Vision 대상이 1,138개를 초과하면 apply를 중단한다. 허용 범위라면 한 번의 실행에서 내부 batch를 순차 처리하며, 성공 hash는 즉시 cache에 기록한다.

설명 성공 이미지만 기존 collection에 `content_type=image_description` 보조 벡터로 upsert한다. 기존 동일 hash 벡터가 있으면 정본 하나를 재사용하며 새 중복을 추가하지 않는다. 본문 벡터의 개수와 내용·metadata·embedding hash를 작업 전후 비교한다.

## 자동 증분 처리

PDF 이미지 추출 후 cache를 먼저 조회한다. 기존 hash는 설명을 재사용하고, 새 hash만 실행 상한 안에서 설명한다. 이미지 변경은 hash 변경으로 감지한다. 설명 또는 Chroma 오류가 발생해도 본문 문서와 본문 벡터 등록은 계속한다.

## 설정

- `SCHAT_PDF_IMAGE_DESCRIPTION_BATCH_SIZE`: 기본 50
- `SCHAT_PDF_IMAGE_DESCRIPTION_MAX_PER_RUN`: 기본 1150

기존 이미지 설명 모델과 API 설정을 재사용하고 재시도는 0으로 유지한다.

## 검증

테스트는 cache 재사용, 신규 hash, 페이지 이동, 빈 응답, 실패, 이미지 없는 PDF, 재업로드를 포함한다. 실제 작업 전 dry-run을 수행하고, 적용 후 대표 페이지의 metadata와 이미지 설명 벡터를 확인한다. production build, Docker 3개 healthcheck, `git diff --check`, 문서 화면 자동 생성을 실행한다.
