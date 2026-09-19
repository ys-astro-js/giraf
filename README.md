# GIRAF

IRAF 패키지와 task를 탐색하고, 파일을 선택해 실행하는 로컬 Web UI입니다. TypeScript 화면과 Python API를 사용하며, 영상 계산은 설치된 IRAF CL 또는 PyRAF가 수행합니다.

## 실행

```sh
uv sync --locked
(cd web && bun install --frozen-lockfile && bun run build)
uv run main.py
```

브라우저에서 <http://127.0.0.1:8501/>을 엽니다. IRAF 본체는 별도로 설치되어 있어야 합니다. Homebrew의 `/opt/homebrew/opt/iraf/libexec`, Linux의 `/usr/lib/iraf`, `/usr/local/lib/iraf`를 탐색하며 다른 경로는 `iraf` 환경변수로 지정합니다. CL 실행에는 `irafcl`이 필요합니다. xgterm은 필요하지 않습니다. Windows에서는 WSL 안에서 서버와 IRAF를 함께 실행하는 구성이 가능하지만, 이 프로젝트의 Windows/WSL 실행은 아직 검증하지 않았습니다.

## 작업 화면

- 왼쪽 자료·패키지에서 task 인스턴스를 추가하고 중앙 연결 작업도에서 선택합니다. 동일 task의 초안을 여러 개 만들 수 있습니다.
- 입력은 폴더 탐색기나 이전 실행 결과에서 선택합니다. 여러 폴더의 파일을 함께 고르거나 선택 묶음을 저장할 수 있습니다. IRAF 목록 파일은 자동 생성됩니다.
- task·전처리·패키지·기기 설정은 각 초안에 독립적으로 저장됩니다. 공통 설정 저장은 이후 새 작업에 적용되며 열린 다른 초안은 바뀌지 않습니다.
- 생성 예정 연결은 필요한 입력이 준비될 때까지 실행을 막습니다. 완료 결과는 실행 버전에 고정되며 상위 재실행 후에도 자동 교체되지 않습니다.
- 헤더 보기에서 `ccdhedit` 초안을 만들고, 결과를 호출한 초안의 선택 입력에만 돌려놓을 수 있습니다. 빈 헤더 값은 삭제입니다.
- 넓은 화면은 세 패널의 너비를 조절하고, 좁은 화면은 자료·작업 목록·상세를 전환합니다. 연결과 목록 접기는 키보드로도 조작할 수 있습니다.
- 출력 영역의 **생성 예정**에서 파일명과 입력 대응을 확인합니다. 실행 후 **최근 실행 결과**에서 열기, 다운로드, 다음 task의 입력으로 보내기를 사용할 수 있습니다.
- 입력 개수와 처리 순서는 고정되어 있지 않습니다. 결합 결과도 다시 결합할 수 있습니다.

`ccdtype`는 실제 IRAF 필터입니다. 입력 헤더의 유형이 다르면 IRAF가 해당 영상을 건너뛸 수 있습니다. 빈 값은 유형으로 거르지 않는 설정입니다. 파일 목록의 추정 분류와 실제 FITS 헤더가 같은지는 `ccdlist`나 `imheader`로 확인할 수 있습니다.

## 지원 task

| 패키지 | Task |
|---|---|
| `noao.imred.ccdred` | `zerocombine`, `darkcombine`, `flatcombine`, `combine`, `ccdproc`, `ccdhedit`, `ccdlist`, `ccdgroups`, `ccdmask`, `badpiximage`, `mkfringecor`, `mkillumcor`, `mkillumflat`, `mkskycor`, `mkskyflat`, `ccdinstrument` |
| `images.imutil` | `imheader`, `imstatistics` |
| `images.tv` | `imexamine`의 `r`, `a`, `m`, `l`, `c` |
| `images.imutil` (범용) | `imcopy`, `imarith`, `imfunction`, `hselect`, `listpixels`, `minmax` |
| `images.imfilter` (범용) | `gauss`, `median`, `boxcar`, `laplace` |
| `images.imgeom` (범용) | `imtranspose`, `imshift`, `magnify` |
| `noao.digiphot.apphot` (범용) | 비대화형 `phot`, `daofind` |
| `noao.onedspec` (범용) | `sarith` |

입력이나 결과 파일의 **영상·통계·A/B** 탭은 내장 영상 뷰어를 엽니다. 확대, 이동, 표시 범위, A/B 비교와 픽셀 조사를 제공합니다. `imexamine`의 측정과 프로파일은 실제 IRAF가 계산하며 GKI 그래픽을 SVG로 표시합니다.

파라미터 정의는 설치된 `.par` 파일에서 읽으며, 기존 전용 task의 없는 항목은 IRAF 2.18.1 스냅샷으로 보완합니다. 지원 정보에서 정의 지문과 차이를 확인합니다. 범용 task는 설치된 `.par`에서 노드 스키마·GUI·워크플로우 포트를 자동 생성하며, 특수 동작은 선택적 override나 실행 어댑터로 보완합니다. [패키지 확장 안내](IRAF_EXTENSIONS.md)를 참고해 주세요. 현재 설치된 모든 패키지를 자동으로 실행하는 범용 CL 콘솔은 아닙니다.

## 실행 기록과 재현

실행마다 `runs/<시간-ID>/`에 입력 사본을 만들고 독립된 `uparm`을 사용합니다. 관련 task를 `unlearn`한 뒤 화면의 파라미터를 명시적으로 전달하므로 사용자 콘솔의 최근 epar 설정에 의존하지 않습니다. 기본 보호 모드에서는 `ccdproc`와 `ccdhedit`도 사본에서 실행합니다. 실제 파일 모드는 실행 전 대상·삭제·백업 계획 확인을 요구합니다.

| 파일 | 내용 |
|---|---|
| `manifest.json`, `sources.json` | 입력, 설정, 원본 경로 및 SHA-256 |
| `commands.cl`, `commands.py`, `commands.json` | CL/PyRAF 실행 명령 |
| `parameters-*` | IRAF 파라미터 기록 |
| `engine.json`, `effective.json`, `assignments.json` | 실행 엔진·IRAF 버전·패키지/전처리의 실제 적용값 |
| `references.json`, `outcomes.json`, `header-diff.json` | 보조 파일 대응, 입력별 처리/건너뜀/실패, 헤더 변경 전후 |
| `interaction.json`, `interaction-history.jsonl` | 대화형 질문과 사용자 응답 기록 |
| `task.log` | IRAF 출력 및 오류 |
| `products.json`, `output/` | 결과 파일, 표시 이름, 입력 대응 및 해시 |

보호 사본 모드에서 사용자가 지정한 결과 이름은 표시·다운로드 이름입니다. 실제 파일 모드에서는 명시 출력 경로를 사용하며, ccdproc의 빈 출력은 입력을 직접 변경합니다. 내부 실행에는 안전한 파일 별칭을 사용합니다. 같은 이름으로 다시 실행해도 실행 폴더가 분리됩니다.

CL과 PyRAF 모두 IRAF를 호출하지만 결과 동등성은 IRAF 버전, 입력 헤더, 파일 순서, 파라미터가 같다는 조건에서 비교해야 합니다. 기존 수동 실행과 자동으로 같아지는 것은 아닙니다.

## 범위

- 로컬 사용자용이며 서버는 `127.0.0.1`에 바인딩합니다.
- 내장 영상 뷰어는 단일 Primary HDU의 2D FITS를 표시합니다. 실행 입력은 IRAF 목록·패턴·section을 지원하고, combine project는 3D 합성 FITS로 검증했습니다. 모든 HDU/차원/IRAF 논리 경로의 조합을 검증한 것은 아닙니다.
- 대화형 overscan fitting은 실제 IRAF GKI 그래픽과 `x y wcs key [명령]` 응답으로 제어합니다. CL은 네이티브 터미널, PyRAF는 그래픽·표준입력 전달 계층을 사용합니다. `q`는 현재 피팅 종료, 전체 중단은 실행 프로세스 종료입니다.
- `ccdinstrument edit=yes`의 네이티브 명령 프롬프트에서 `help`, 매핑 명령, `write`, `quit` 등을 입력합니다. 보호 모드의 변경 파일은 실행 폴더에 보관됩니다.
- combine의 scale/zero/weight `@파일`, offsets 파일, BPM 마스크, project, sigma/plfile 출력을 실제 IRAF로 검증했습니다. 설치 IRAF 2.18.1의 `clobber=yes`는 폐기된 옵션이므로 오류로 안내합니다.
- 임의 CL 명령을 실행하는 콘솔은 제공하지 않습니다.
- 기본값이 요구하는 보정 기준 자료를 선택하거나 해당 보정을 꺼야 합니다. 보정 이력과 영상 조건의 적합성은 각 IRAF task의 의미에 따라 확인해야 합니다.
- 비대화형 측광과 스펙트럼 연산을 지원합니다. 대화형 스펙트럼 추출·파장 보정 database·특수 커서 작업은 추가 어댑터가 필요합니다.
- 기존 workflow 실행 코드와 기록 읽기는 호환성을 위해 남아 있습니다. 새 task 실행은 `task_jobs.py`와 `task_worker.py`를 사용합니다.

## DS9 없이 imalign 실행

`images.immatch.imalign`에서 입력 영상과 기준 영상을 선택한 뒤, **기준별 좌표 → 영상에서 별 선택**으로 기준 영상의 별을 추가합니다. 확대·키보드 이동·좌표 입력을 사용할 수 있으며, 직접 입력은 한 행에 `X Y` 형식입니다. 좌표는 FITS의 1부터 시작하는 픽셀 좌표입니다.

**초기 이동량 → 같은 별로 이동량 계산**에서 각 입력 영상의 같은 별을 선택하면 첫 번째 기준별과의 차이(`Xref − Xin`, `Yref − Yin`)가 입력 순서대로 채워집니다. 미선택 행의 `? ?`는 모두 채워야 합니다. 이동량을 비우면 IRAF가 `bigbox`로 초기 이동량을 추정하므로, 첫 번째 별은 밝고 고립된 별을 선택해 주세요. 기존 좌표·이동량 파일도 **기존 입력**에서 사용할 수 있습니다.

좌표와 이동량은 실행 폴더의 `lists/coords.txt`, `lists/shifts.txt`로 전달되며, 실행 기록과 작업 복원에 보존됩니다. 기준 영상이나 입력 순서 변경 시 좌표와 이동량을 재확인합니다. 영상에서 선택하려면 개별 FITS 파일 또는 실행 완료한 영상 결과를 지정해 주세요. 표현식·목록 파일은 실행 시 해석되므로 직접 수치 입력이나 기존 파일을 사용할 수 있습니다. 실제 정렬·중심 측정·공통 영역 자르기는 IRAF가 수행하며 DS9을 실행하지 않습니다.

## 개발 및 검증

```sh
cd web
bun install --frozen-lockfile
bun run typecheck
bun run build
```

프로젝트 루트에서:

```sh
uv run python -m unittest discover -s tests -v
bun test tests/ui
```

실제 IRAF로 가변 개수 결합과 재결합, CL/PyRAF 수치 비교, bias/dark/flat 보정, subset 분리, 헤더 편집, 통계, imexamine 그래프, 마스크와 CCD 보정 영상 생성, dry run 및 원본 해시 보존을 검사합니다. 모든 task와 파라미터 조합에 대한 동등성 검증은 아닙니다.

구현 전 테스트와 수동 검증 결과: [연결 작업도 검증 기록](docs/task-map-verification.md).

### 범용 IRAF 패키지

설치된 패키지 선언과 `.par`에서 작업 목록 및 파라미터 폼을 자동 생성합니다. 기존 CCD 실행 외에 영상 연산·필터, 비대화형 측광 `phot`/`daofind`, 스펙트럼 연산 `sarith`를 공통 실행기로 연결했습니다. `datapars`/`photpars` 등의 파라미터 세트와 복수 출력도 지원합니다.

새 패키지는 `GIRAF_IRAF_PACKAGE_ROOTS`, 추가 입출력 계약은 `GIRAF_TASK_DESCRIPTORS`로 지정할 수 있습니다. 지정한 경로의 패키지 파일이나 계약 변경은 작업 목록의 새로고침으로 반영하며, 환경변수를 바꾸면 서버를 재시작해야 합니다. 작업별 계약 없이 parameter의 타입·모드·기본값·설명으로 GUI와 입출력 포트를 생성하며, 소스 I/O 정보가 있으면 보완합니다. 모든 IRAF 작업을 자동 실행하거나 패키지를 설치하는 기능은 아닙니다.

등록 예제, 현재 실행 범위와 제한은 [IRAF 패키지 확장 안내](IRAF_EXTENSIONS.md)를 참고해 주세요.

## 프로젝트 구조

Python 프로젝트와 패키지 이름은 `giraf`입니다. 프론트엔드 소스는 `web/`, 백엔드는 `giraf/`에 있습니다.

`web/dist/`는 Git에 포함하지 않으므로 최초 실행 전에 위 빌드 명령을 실행해 주세요. `runs/`, `output/`, `.workspace.json`, `.workflow/`, `observations/` 및 관측 FITS 자료는 로컬 데이터이며 Git에서 제외됩니다. 가상환경은 `uv sync --locked`로 생성합니다.
