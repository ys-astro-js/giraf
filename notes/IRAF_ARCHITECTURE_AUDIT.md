# IRAF 구성 조사 — 2026-09-17

이 문서는 구현 제안이 아니라 설치본·공식 문서·공식 소스·PyRAF 객체에서 확인한 사실을 기록한다. 제품 코드 및 실행 중인 웹 서버는 이 조사에서 변경하지 않았다. 런타임 확인은 별도 임시 디렉터리와 독립 uparm/PyRAF CL 캐시에서 수행했으며 과학 계산 작업은 호출하지 않았다.

## 실제 구성

1. 패키지 로딩은 CL 코드 실행이다. `imutil.cl`은 논리 디렉터리를 설정하고 여러 task를 같은 `imutil$x_images.e` 실행 파일에 등록한다. 물리 디렉터리 계층과 등록된 task/package 관계는 동일한 개념이 아니다. 외부 패키지, 조건부 등록, 별칭과 재정의도 고려해야 한다.
2. 실행 형태에는 컴파일된 task, CL procedure, package, pset 등이 있다. 설치된 `scopy.cl`은 입력·출력과 선택 조건을 받아 `sarith`를 호출한다. .par 파일만 있는지 확인하는 것으로 전체 등록 task를 열거할 수 없다.
3. `.par`의 기본 레코드는 name/type/mode/value/min/max/prompt다. `a/q/h/l`은 질의·학습 모드이며 파일 입력·출력 방향이나 필수 여부 자체가 아니다. `f`는 파일명이고 e/n/r/w 수식은 존재·접근 검사다. `*` 타입은 목록 지향 파라미터이며, 이미지 템플릿 문자열을 의미하는 `s`와 같지 않다. `pset`, 간접 참조, cursor, struct를 별도로 취급해야 한다.
4. PyRAF는 `getTask`, `getPkg`, `getTaskList`, `getParList`, `getDefaultParList`, `getParpath`, `getFilename` 등을 제공한다. 이는 이미 있는 task/parameter 로더이며, 자체 정규식 스캐너를 사실의 기준으로 삼을 근거가 없다.
5. 실제 입출력 의미는 task 실행 코드에도 있다. 모든 파일 파라미터에 방향·자료 종류·출력 개수가 통일된 필드로 들어 있다는 근거는 확인되지 않았다. 검토한 PyRAF parameter 객체에도 workflow input/output/cardinality 속성이 없다. 이는 도움말 추정만으로 실행 계약을 확정해도 된다는 의미가 아니다.
6. 표준 출력, 표준 오류, 그래픽, 질의는 CL/task IPC의 서로 다른 채널이다. 결과 표를 모두 로그로 취급하면 다음 task의 입력으로 연결하지 못한다.

## 설치본 및 런타임 확인

IRAF root: `/opt/homebrew/opt/iraf/libexec`.
기존 파서로 읽힌 .par 파일: 788개. 이는 등록 task 수가 아니며 pset 등을 포함한다. 기존 화면의 595개 역시 자체 스캐너 발견 수로, IRAF 전체 task 수로 부를 수 없다.

| 런타임 task | PyRAF class | 실제 경로 | 확인 사항 |
| --- | --- | --- | --- |
| imutil.imstack | IrafTask | imutil$x_images.e | images=s, output=f, 둘 다 mode=a. 이미지 목록 입력과 단일 출력 관계는 이 타입만으로 확정되지 않는다. |
| onedspec.scopy | IrafCLTask | onedspec$scopy.cl | input/output 모두 s. 내부에서 sarith 호출. |
| apphot.phot | IrafTask | apphot$x_apphot.e | image/coords/output=f, datapars/photpars=pset. 같은 파일 타입으로 입력·출력 역할이 다르다. |

## 공식 소스 대조

- `pkg/images/imutil/src/t_imstack.x`: images를 imtopenp로 열고 목록을 반복, 입력은 immap READ_ONLY, 출력은 NEW_COPY로 처음에 생성한다. 다대일 출력.
- `pkg/images/imgeom/src/t_blkavg.x`: input/output 양쪽을 imtopen으로 열고 두 목록을 함께 반복한다. 입력 READ_ONLY, 출력 NEW_COPY. 입력·출력 목록의 대응이 필요하다.
- `noao/onedspec/scopy.cl` (설치본): procedure 선언과 sarith 호출을 확인했다. 조건(format/merge/clobber 등)에 따라 실행 의미를 고려해야 한다.
- `noao/digiphot/ptools/txtools/t_txdump.x`: textfiles를 clpopnu로 받고 파일을 READ_ONLY/TEXT_FILE로 연다. .par에는 출력 파일 파라미터가 없으므로 stdout 결과 채널을 별도로 다뤄야 한다.

## 현재 GIRAF 구현의 확인된 결함

- 패키지 등록을 실제 로더 대신 디렉터리와 정규식으로 재구성한다.
- .par가 발견된 task만 대상으로 삼는다.
- 수작업 프로파일이 없으면 실행을 일괄 차단한다.
- 사용자에게 JSON 작업 정의를 작성하도록 요구한다.
- 공통 실행기의 출력 방식은 single/each로 제한돼 실제 목록 대응, 조건부 출력, 제자리 변경을 일반적으로 표현하지 못한다.
- 워크플로우 서버 연결은 결과의 asset 종류로 필터링하지만, 같은 종류의 서로 다른 출력 역할을 선택하는 sourceRole 연결은 구현되지 않았다.
- 목록·폼 생성, 실행 지원, 워크플로우 연결 지원을 같은 수준의 완성도로 소개했다.

## 아직 검증되지 않은 사항

- 전체 설치 패키지에 대한 실제 로더 기반 등록 목록 및 로딩 실패 범위.
- IRAF/PyRAF IPC·I/O 계층에서 파일 역할과 결과를 공통 계측할 수 있는 정확한 범위. 런타임 관찰만으로 실행 전 모든 분기의 입출력을 알 수 있다고 주장할 수 없다.
- 컴파일된 task와 CL procedure의 정보를 조합해 조건부 입출력·다중 출력·database·cursor를 워크플로우 계약으로 만드는 범위와 필요한 보완 데이터.

이 항목들을 검증하기 전, 595개 완전 자동 지원·단순 도움말 추론·폴더 전체 복사·작업별 코드 595개 추가 중 어느 것도 확정 설계로 삼지 않는다. 기존에 추가한 추론/네이티브 실행 관련 테스트는 요구를 검증한 근거가 아니며, 제품에 해당 구현은 아직 없다.

## 근거

- https://iraf.readthedocs.io/en/latest/clman.html
- https://iraf.readthedocs.io/en/latest/tasks/language/parameters.html
- https://iraf.readthedocs.io/en/latest/tasks/language/task.html
- https://github.com/iraf-community/iraf/blob/main/pkg/images/imutil/src/t_imstack.x
- https://github.com/iraf-community/iraf/blob/main/pkg/images/imgeom/src/t_blkavg.x
- https://github.com/iraf-community/iraf/blob/main/noao/digiphot/ptools/txtools/t_txdump.x
- 로컬 `.venv/lib/python3.12/site-packages/pyraf/iraftask.py`, `irafpar.py`, `iraffunctions.py`
