# Docker 빌드 캐시 자동 관리

2026-10-10 사용자 서버 점검: 빌드 캐시 21GB(87개)가 디스크 부족의 주원인이었음. 아래는 사용자가 Google Cloud SSH에서 직접 적용하는 안내이며, 아직 서버 설정을 변경한 것은 아님.

## 설정 목적

빌드 캐시는 프로그램을 다시 만들 때 시간을 줄이는 임시 재료임. 40GB 디스크에서는 우선 **5GB 기준**을 제안함. SCHAT 관리 제안값이지 Docker의 고정 권장값은 아님. 다음 빌드가 느려질 수 있음.

자동 정리(GC)는 주기적으로 동작하므로 **항상 5GB 이하를 보장하는 제한이 아님**. 빌드 중 자료와 최종 이미지·DB는 별개이며 여유 공간이 필요함. 기본 `docker` 빌더는 `daemon.json`의 `builder.gc`로 설정함. [Docker 공식 안내](https://docs.docker.com/build/cache/garbage-collection/)

## 1. 빌더 확인

배포와 같은 sudo 권한으로 실행함.

```bash
sudo docker version --format '{{.Server.Version}}'
sudo docker buildx ls
```

배포에 사용하는 빌더의 DRIVER가 **docker일 때만** 아래를 진행함. docker-container·원격·별도 지정 빌더는 설정 위치가 다르므로 먼저 확인해야 함. 빌더 삭제·교체나 Docker 업데이트는 하지 않음.

## 2. 점검 시간 확보와 설정 백업

Docker 재시작 시 SCHAT 및 같은 서버의 다른 서비스도 잠시 끊길 수 있음. 직원에게 알리고 빌드·업로드·답변 생성이 없는 시간에 진행함. 데이터 백업도 확보되어 있는지 확인함.

```bash
sudo test -f /etc/docker/daemon.json && sudo cp -a /etc/docker/daemon.json /etc/docker/daemon.json.before-cache-gc-$(date +%Y%m%d-%H%M%S)
```

파일이 원래 없으면 복사하지 않음. 기존 파일이 있었다면 백업 성공 여부와 정확한 백업 경로를 확인한 뒤 진행함. 기존 설정 내용을 채팅에 그대로 공유하지 않음.

## 3. 기존 설정을 보존하며 편집

```bash
sudoedit /etc/docker/daemon.json
```

파일이 원래 없거나 비어 있을 때의 전체 예시:

```json
{
  "builder": {
    "gc": {
      "enabled": true,
      "defaultKeepStorage": "5GB"
    }
  }
}
```

기존 내용이 있다면 위 예시로 **통째로 덮어쓰지 않음**. 기존 항목·쉼표를 유지하며 `builder.gc.enabled`와 `builder.gc.defaultKeepStorage`만 병합함. 같은 이름의 builder 항목을 두 번 만들지 않음. 이미 `builder.gc.policy` 같은 별도 정책이 있으면 단순 병합만으로 원하는 결과가 나지 않을 수 있으므로 검토 전에는 재시작하지 않음. 로그·네트워크·데이터 경로 설정은 유지함.

## 4. 재시작 전 검사

```bash
sudo dockerd --validate --config-file=/etc/docker/daemon.json
```

성공했을 때만 다음으로 진행함. JSON 오류·미지원 옵션·권한 오류 또는 검사 기능이 없는 버전이면 **재시작하지 않음**. systemd의 기존 실행 옵션과 중복된 설정도 주의해야 하며 검사 성공이 실제 시작 성공을 모두 보장하지는 않음.

## 5. 점검 시간에 반영

```bash
sudo systemctl restart docker
sudo systemctl is-active docker
sudo docker ps -a
```

Docker가 active이고 SCHAT 세 컨테이너가 정상인지 확인함. starting이면 잠시 후 다시 확인함. 반복 종료되거나 Docker가 시작하지 못하면 추가 정리를 하지 않음. 기존 파일이 있었다면 백업의 정확한 경로를 지정해 복원하고 검사 후 재시작해야 함. 원래 없던 파일은 추가한 설정만 되돌려야 하므로 임의 파일 삭제 명령을 사용하지 않음.

## 6. 공간·서비스 확인

```bash
sudo docker system df
df -h
sudo docker ps
```

로그인·문서 검색·원본 보기를 확인함. 즉시 5GB로 줄지 않을 수 있음. 기존 정리 대상 캐시는 빌드 완료 후 별도로 정리할 수 있음.

```bash
sudo docker builder prune -f
sudo docker system df
df -h
```

회수량을 기록함. `-a`를 추가하지 않음. 기본 명령은 모든 미사용 캐시를 무조건 제거하는 방식이 아니므로 일부가 남을 수 있음. [공식 builder prune 설명](https://docs.docker.com/reference/cli/docker/builder/prune/)

## 절대 지우지 않을 것

- DB, Chroma volume, server/storage, 원본 PDF, 체크리스트, 문서 이미지, .env.
- docker volume prune, docker compose down -v, 전체 정리용 docker system prune으로 대체하지 않음.
- /var/lib/docker 내부 파일을 수동 삭제하지 않음.

이 절차는 빌드 캐시 관리이며 데이터 삭제나 재색인이 아님. 적용 완료·실제 회수량은 아직 미확인임.
