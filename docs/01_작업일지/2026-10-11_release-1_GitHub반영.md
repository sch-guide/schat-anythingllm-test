# release-1 GitHub 반영

- 사용자 승인으로 a2c317f9에 release-1 브랜치를 만들고 해당 브랜치만 push함. checkout·추가 commit·tag·main push 없음.
- 원격 확인: release-1=a2c317f9e1ebd34c27f23ba298ee66fca877431f, main=b5aa77bd87722134014f7ef9314db64867bf18c3 유지함.
- 21개 커밋 구간의 storage 변경 없음. 기존 추적 storage 89개는 그대로임. 커밋 구간 경로에서 preview-storage·PDF·DB·실제 .env 추가/변경 없음. 주요 키 패턴 검사 0건. 전체 비밀정보 부재를 자동 검사만으로 보증하지는 않음.
- 미커밋 파일을 stage하지 않음. stash faf92e9f6c63de1e773247799e505feeef123746 유지함. diff --check 통과함.
- DB migration 3개 SQL 확인: 동의어 후보, 후보 실행 기록/run_id, 개인 체크·메모 저장. CREATE/ADD이며 기존 자료 삭제 SQL 없음. 운영 실제 미적용 목록은 배포 전에 확인해야 함.
- 브라우저 확인은 요청에 따라 생략함. 기존 3001/3002/3003·Google Cloud 변경·실제 Gemini 호출 없음.
- 상세 서버 실행 안내를 docs/release-1_서버실행_단계별안내.md에 작성함. 이번 안내 문서와 문서 화면 현행화는 정확한 release 커밋 보존을 위해 추가 커밋/push하지 않음.
- 다음: 사용자가 점검 시간 확보 후 스냅샷·실제 서버 설정 확인·반영·업무 확인을 직접 진행함. 서버 설정이 안내 전제와 다르면 강제 진행하지 않음.
- 문서 화면 재생성과 분리 검사 11개 통과함. 기존 Python 정규식 escape 경고는 있으나 실패 없음. 최종 stage는 비어 있고 HEAD/release-1/stash 번호가 유지됨.
