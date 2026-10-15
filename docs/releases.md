# 릴리스와 업데이트 내역

`main`에 push하면 `.github/workflows/desktop.yml`이 데스크톱 앱을 빌드해 Releases에 `v1.4.<빌드 번호 − 17>`로 올리고(1.4의 첫 릴리스가 17번째 빌드라 `v1.4.0`부터 셉니다), 설치된 앱은 이 릴리스로 자동 업데이트합니다.

## 업데이트 내역은 `RELEASE_NOTES.md`

릴리스 노트는 커밋 로그가 아니라 루트의 `RELEASE_NOTES.md`입니다. 이 파일이 최신 릴리스 본문과 다를 때만 빌드·릴리스하고, 같으면 빌드를 건너뜁니다. 수동 실행(workflow_dispatch)은 항상 빌드합니다.

- 사용자에게 보이는 변경을 커밋할 때 같은 커밋에서 `RELEASE_NOTES.md`를 고칩니다.
  - 파일이 최신 릴리스 본문과 같으면(이미 배포된 내역) 새 내역으로 바꿔 씁니다.
  - 다르면(아직 배포 전) 항목을 덧붙입니다.
- 내부 변경(리팩터링, 빌드·CI, 테스트, 문서)만 있으면 파일을 건드리지 않습니다. 그 push는 릴리스되지 않고, 다음 업데이트에 함께 나갑니다.
- 형식: `## 새 기능`, `## 개선`, `## 수정` 중 해당하는 절만, 항목은 `- `로 시작하는 한 문장.
- 사용자가 겪는 변화로 씁니다. 무엇을 할 수 있게 됐는지, 무엇이 고쳐졌는지를 앱 화면의 용어로 적고, 코드·라이브러리·파일 이름이나 구현 방법은 쓰지 않습니다.
  - 좋음: "Windows 사용자 폴더(C:)의 파일을 파일 브라우저에서 열 수 있습니다."
  - 나쁨: "listing()에서 PermissionError 무시", "fix: Linux 빌드에 X11 헤더 설치"

## 커밋 제목

커밋 제목은 개발 기록입니다. `feat`/`fix`는 사용자에게 보이는 변경에만 쓰고, 빌드·CI는 `ci`/`build`, 구조 변경은 `refactor`로 씁니다.

## 데스크톱 앱 직접 빌드하기

Python 런타임과 의존성, 웹 화면을 담은 독립 실행형 앱(Electron)을 만듭니다. IRAF는 앱에 포함되지 않으며, 로그인 셸의 환경(`iraf`, `PATH`)을 그대로 씁니다.

```sh
cd desktop
bun install
bun run dist
```

`desktop/dist/`에 현재 OS용 설치 파일(macOS `.dmg`, Linux `.AppImage`)이 생깁니다. 로컬 빌드는 서명하지 않으므로 다른 Mac에서는 처음 열 때 우클릭 → 열기가 필요합니다.

- 앱의 실행 기록과 상태는 `~/Documents/GIRAF`에 저장됩니다(로그: `giraf.log`).
- Mac 앱은 GitHub Secrets의 Developer ID 인증서로 서명·공증해야 스스로 업데이트할 수 있습니다(`MAC_CERTIFICATE`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). 없으면 서명하지 않고 빌드합니다.
- Windows 앱(`.exe`)은 WSL 안의 IRAF를 씁니다. 앱에 담긴 Linux 백엔드를 처음 실행할 때 WSL의 `~/.giraf/runtime`에 풀어 실행합니다. 파일 바로가기와 기본 작업 폴더(`문서\GIRAF`)는 Windows 사용자 폴더(WSL에서 `/mnt/c/Users/<이름>`)를 쓰고, 실행 기록과 상태는 WSL의 `~/.giraf/data`에 둡니다. WSL에서 `/mnt/c`를 읽고 쓰면 느리기 때문입니다. Windows 설치 파일은 Linux에서 준비한 백엔드를 담기 때문에 GitHub Actions에서만 만듭니다.
