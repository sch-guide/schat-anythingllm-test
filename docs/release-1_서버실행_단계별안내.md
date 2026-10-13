# release-1 서버 실행 단계별 안내

2026-10-11. GitHub `release-1`은 `a2c317f9e1ebd34c27f23ba298ee66fca877431f`임. main은 push하지 않음. 아래는 사용자가 실행할 안내이며 서버에 적용한 결과가 아님. 브라우저 검사는 요청에 따라 생략함.

## 먼저 알아둘 것

- 기존 origin/main `b5aa77bd`부터 21개 커밋을 포함함. 미커밋 파일·stash·preview-storage·시험용 PDF·실행 DB는 이번 push에 추가하지 않음. 기존 Git에 있던 storage 89개는 그대로이며 이 구간 storage 변경은 0개임.
- 새 DB 변경은 3개: 동의어 후보 표, 동의어 실행 기록 표와 후보의 실행번호 항목, 계정별 체크·환자정보·메모 표임. SQL에 기존 표 삭제·자료 삭제 명령은 없음. 실제 서버의 미적용 변경이 꼭 3개인지는 아래에서 다시 확인함.
- 첫 반영은 **30~60분 이상 점검 시간**을 확보하는 것을 제안함. 실측이 아니며 CPU 2개/메모리 3.8GB에서 빌드·이미지 내려받기·메모리 부족 때문에 더 길어질 수 있음. DB 변경 자체보다 빌드가 오래 걸릴 가능성이 있음.
- 명령은 Google Cloud SSH의 Linux Bash용임. 한 줄씩 실행하고 오류가 있으면 다음 줄로 넘어가지 않음. 자동 복구 스크립트가 아님.
- 기존 compose 파일, 프로젝트 이름, DB·Chroma 연결 경로를 바꾸면 빈 자료실이 생길 수 있음. 아래 예시는 기존 배포가 `~/schat-anythingllm-test/docker/docker-compose.yml` 하나를 사용하는 경우에만 적용함. 다르면 기존 배포 방식에 맞춰야 하므로 중단함.

## 준비: 실행 위치와 기존 저장 위치 확인

직원에게 점검을 알리고 새 질문·문서 업로드를 멈추도록 함. 먼저 실행 환경만 조회함.

```bash
cd "$HOME/schat-anythingllm-test"
git status --short
sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' schat-web
sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' schat-web
sudo docker inspect --format '{{.Name}} {{range .Mounts}}{{.Type}}:{{.Source}} -> {{.Destination}}; {{end}}' schat-web schat-chromadb
df -h
```

출력에서 DB가 있는 storage와 Chroma의 실제 저장 위치를 기록함. 별도 디스크이면 그 디스크도 스냅샷 대상임. 전체 inspect나 .env는 공유하지 않음. 기존 프로젝트 이름을 아래 변수에 담음. 빈 값이면 중단함.

```bash
SCHAT_PROJECT=$(sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' schat-web)
printf '%s\n' "$SCHAT_PROJECT"
```

## 0. 수동 스냅샷 만들기

DB와 검색 자료가 쓰이는 중간 상태를 피하려고 먼저 앱을 정상 중지함. 아래 컨테이너 이름이 실제 조회 결과와 같을 때만 실행함. 답변·업로드가 끝난 뒤 진행함. 이때부터 직원이 사용할 수 없음.

```bash
sudo docker stop --time 120 schat-web
sudo docker stop --time 60 schat-chromadb schat-safety-evaluator
sudo docker ps -a --format 'table {{.Names}}\t{{.Status}}'
sync
```

컨테이너가 정상 종료됐는지 확인함. 강제 종료(예: 137)나 다른 프로그램이 같은 DB에 쓰는 상황이면 일관된 백업 여부를 먼저 확인함. Docker/VM 자체는 계속 켜 두어 SSH와 IP를 유지함.

1. Google Cloud 콘솔 → SCHAT 프로젝트 선택 → **Compute Engine → 스냅샷**으로 이동함.
2. **스냅샷 만들기** → 이름 `schat-before-release-1-20261011`처럼 입력함.
3. 원본 디스크에서 SCHAT VM의 실제 부팅 디스크를 선택함. 보관 유형은 일반(Standard)을 선택하고 생성함.
4. 준비 완료 상태까지 기다림. DB·Chroma가 별도 디스크이면 중지 상태를 유지한 채 그 디스크들도 같은 시점의 백업 묶음으로 생성함.
5. 스냅샷 이름, 원본 디스크, VM의 영역·네트워크·서비스 계정·외부 IP를 기록함. 앱은 아직 시작하지 않음.

디스크 스냅샷은 VM의 모든 설정을 함께 복원하는 버튼이 아님. [Google 공식 스냅샷 생성 안내](https://docs.cloud.google.com/compute/docs/disks/create-snapshots)를 참고함.

## 1. 현재 버전 기록

```bash
git rev-parse HEAD
git branch --show-current
git status --short
sudo docker inspect --format '{{.Name}} image={{.Image}}' schat-web schat-chromadb schat-safety-evaluator
```

출력은 안전한 개인 기록에 보관함. 현재 커밋·브랜치·이미지 ID·프로젝트 이름·마운트 경로가 복구 기준임. 기존 수정은 지우지 않음. 특히 코드나 compose 수정이 있으면 자동 진행하지 말고 비교해야 함. storage의 기존 수정도 보존함.

## 2. release-1 받기 — main pull 금지

```bash
git fetch origin refs/heads/release-1:refs/remotes/origin/release-1
git rev-parse origin/release-1
git diff --name-status HEAD origin/release-1 -- server/storage docker/docker-compose.yml server/prisma
git diff HEAD origin/release-1 -- docker/docker-compose.yml
```

release 번호가 `a2c317f9e1ebd34c27f23ba298ee66fca877431f`인지 확인함. storage 변경이 나오거나 compose의 기존 저장 위치가 바뀌면 중단함. 서버가 b5aa77bd와 다르면 DB 변경 목록도 달라질 수 있음.

```bash
git switch --detach a2c317f9e1ebd34c27f23ba298ee66fca877431f
git rev-parse HEAD
git status --short
```

브랜치 끝이 나중에 움직여도 이번에 확인한 버전만 사용하려고 정확한 커밋에 고정함. 충돌하면 강제 전환·reset·clean·stash를 하지 않음. 미커밋 변경이 새 코드에 섞이는 경우에도 그대로 빌드하지 않음.

## 3. DB 변경 안전 확인

새 SQL을 읽음. 세 파일에는 CREATE TABLE/INDEX와 새 후보 표의 ADD COLUMN만 있음. 사용자·문서·대화 표를 지우는 SQL은 없음.

```bash
cat server/prisma/migrations/20261010000000_schat_synonym_suggestions/migration.sql
cat server/prisma/migrations/20261010010000_schat_synonym_suggestion_runs/migration.sql
cat server/prisma/migrations/20261011020000_checklist_personal_state/migration.sql
```

운영 DB의 현재 migration 이력과 비교는 새 이미지가 있어야 정확하므로 아래 빌드 후 실행함. **앱을 시작하면 entrypoint가 migrate deploy를 자동 실행하므로, 확인 전 up부터 하지 않음.** 기존 자료 보존은 SQL 확인·중지 상태 스냅샷·적용 후 업무 확인을 함께 해야 함. 파일만 보고 운영 DB 무손상을 보장할 수는 없음.

## 4. 빌드 → DB 적용 → 시작

같은 SSH 세션에서 진행함. 세션이 끊겼으면 SCHAT_PROJECT를 기존 기록과 대조해 다시 설정해야 함. 아래 프로젝트 이름이 비어 있거나 기존과 다르면 실행하지 않음.

```bash
printf '%s\n' "$SCHAT_PROJECT"
sudo docker compose -p "$SCHAT_PROJECT" -f docker/docker-compose.yml build
```

빌드가 성공한 뒤, 앱과 Collector를 시작하지 않는 일회성 명령으로 migration 상태만 조회함. 기존 DB 볼륨을 사용하므로 앞의 경로 확인이 필수임.

```bash
sudo docker compose -p "$SCHAT_PROJECT" -f docker/docker-compose.yml run --rm --no-deps --entrypoint sh schat-web -lc 'cd /app/server && npx --no-install prisma migrate status --schema=./prisma/schema.prisma'
```

미적용 변경 때문에 종료 코드가 1일 수 있음. 위 3개만 미적용인지 확인함. 이미 일부 적용됐으면 더 적을 수 있음. 실패 이력·DB 연결 오류·예상 외 변경은 진행 중단 사유임. 정상 확인 후 적용함.

```bash
sudo docker compose -p "$SCHAT_PROJECT" -f docker/docker-compose.yml run --rm --no-deps --entrypoint sh schat-web -lc 'cd /app/server && npx --no-install prisma migrate deploy --schema=./prisma/schema.prisma'
sudo docker compose -p "$SCHAT_PROJECT" -f docker/docker-compose.yml run --rm --no-deps --entrypoint sh schat-web -lc 'cd /app/server && npx --no-install prisma migrate status --schema=./prisma/schema.prisma'
```

모두 적용됐다는 결과를 확인한 뒤 시작함. startup의 동일 migration 명령은 적용된 항목을 다시 만들지 않음.

```bash
sudo docker compose -p "$SCHAT_PROJECT" -f docker/docker-compose.yml up -d --no-build
sudo docker compose -p "$SCHAT_PROJECT" -f docker/docker-compose.yml ps
sudo docker inspect --format '{{.Name}} {{range .Mounts}}{{.Source}} -> {{.Destination}}; {{end}}' schat-web schat-chromadb
```

기존과 같은 DB·Chroma 위치인지 비교함. 새 빈 볼륨이 연결됐다면 사용을 재개하지 않음. 오류 조사 시 로그는 서버에서만 확인하고 키·직원 질문·메모를 복사하지 않음. Prisma reset, db push --force-reset, migration resolve로 억지로 통과시키지 않음.

## 5. 직접 확인 목록

https://schat-sch.duckdns.org 에서 확인함. 이 안내 작성 중 사이트 접속·실제 API 호출은 하지 않음. 실제 질문은 Gemini 사용량에 포함됨.

1. 기존 관리자·직원 계정 로그인, 기존 문서·체크리스트·퀴즈 개수가 이전과 같은지 확인함.
2. 기존 지침에 근거한 간단한 질문 1개 → 답변·출처 확인. PDF 출처 → 정확히 찾은 근거가 PC·모바일에서 연한 파란색인지 확인함. 못 찾으면 원문 안내가 나오는 것이 정상일 수 있음.
3. 체크리스트에 실제 환자 대신 `612호 / 홍길동`, 합성 메모 입력 → 이름 `홍○동` 가림 → 같은 계정 다른 브라우저에서 확인 → 다른 계정에는 없는지 확인함.
4. 관리자 메뉴의 대기열·사용량·예산·동의어 후보·답변 재사용 화면이 열리는지 확인함. 예산 단가가 없으면 계산 불가 표시가 정상임. 임의 후보 자동 승인이나 전체 생성은 하지 않음.
5. 개인정보 없는 별도 `release1-확인전용.pdf` 등록 → 같은 이름의 내용이 다른 PDF 업로드 → 업데이트/취소 팝업 → 먼저 취소하여 기존 내용 유지 확인 → 다시 업데이트하여 새 내용만 검색되고 이전 원본이 보관되는지 확인함. 실제 지침으로 시험하지 않음. 여러 파일 중 중복 목록도 확인함.

## 6. 정상 확인 후 빌드 캐시만 정리

다른 빌드가 없는 때 실행함.

```bash
sudo docker builder prune -f
sudo docker system df
df -h
```

`-a`나 `--volumes`를 더하지 않음. DB·Chroma volume·storage·PDF는 삭제하지 않음. docker volume prune, compose down -v, system prune으로 대체하지 않음. 캐시 정리는 DB 복구 수단이 아님.

## 7. 문제 발생 시 복구

- DB 적용 전 빌드만 실패했고 자료가 바뀌지 않았으면 기존 컨테이너는 남아 있음. 기존 Chroma·평가기부터 시작하고 정상 준비 후 schat-web을 시작하여 기존 이미지로 복귀할 수 있음. 기존 컨테이너가 교체됐다면 이 방법을 사용하지 않음.
- DB 적용 이후 실패하면 이번 SQL이 추가형이어도 옛 앱과의 호환을 단정하지 않음. 코드 번호만 되돌려 해결됐다고 판단하지 말고, 서비스 중지 후 스냅샷 복원을 기준으로 진행함.
- 복원하면 **스냅샷 이후 작성한 자료는 복원본에 없음**. 점검 중 업무 사용을 막는 이유임. 이미 새 자료가 생겼으면 바로 덮어쓰지 말고 보존 방법부터 결정함.

스냅샷 복구 화면 순서:

1. 문제가 난 VM은 중지하되 삭제하지 않음.
2. Compute Engine → 디스크 → 디스크 만들기 → 원본 유형 스냅샷 → 앞서 기록한 스냅샷 선택 → 기존 VM과 같은 영역에 새 이름으로 생성함.
3. 부팅 디스크 스냅샷이면 복구용 VM 생성 시 해당 스냅샷/복원 디스크를 부팅 디스크로 선택함. 별도 데이터 디스크도 같은 백업 묶음에서 복구·연결함.
4. 기존 VM의 사양·서비스 계정·네트워크·방화벽·연결 위치를 맞춤. 기존/복구 VM을 동시에 서비스하지 않음. DuckDNS 자동 갱신 작업도 두 곳에서 경쟁하지 않게 함.
5. 복구 VM의 자료·로그인·검색을 먼저 확인한 뒤 기존 고정 IP 또는 DuckDNS 연결을 복구 VM으로 전환함. 외부 IP가 달라지면 주소 갱신과 HTTPS도 확인함.
6. 복구 성공 전 기존 디스크·VM·스냅샷은 삭제하지 않음. 복구용 자원에는 추가 비용이 생길 수 있음.

[Google 공식 스냅샷 복원 안내](https://docs.cloud.google.com/compute/docs/disks/restore-snapshot). 이 과정은 별도 새 디스크/VM을 이용하는 복구이며 기존 디스크를 직접 덮어쓰는 명령을 제공하지 않음.

## 이번 준비의 한계

실제 서버 경로·compose·DB 이력·복원 가능성·소요 시간은 미확인임. 코드 테스트의 과거 결과와 실제 운영 검증을 구분함. 이번에는 Git 범위·SQL·원격 브랜치 확인을 수행했으며 전체 앱 테스트와 build를 새로 실행한 것은 아님. 이 상세 안내와 작업일지 현행화는 요청한 정확한 커밋을 유지하기 위해 로컬 미커밋으로 남김.
