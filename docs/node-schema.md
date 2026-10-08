# 노드 스키마 v2

노드의 입출력 포트, 설정 탭 구성, 고정 파라미터를 코드가 아닌 JSON 스키마로 정합니다. IRAF에서 자동 생성한 스키마 위에 필요한 부분만 덮어씁니다. IRAF 작업이 아닌 GIRAF 노드(파일 입력, 파일 저장 등)도 같은 형식으로 정의합니다([GIRAF 노드](#giraf-노드)). 관련 이슈: #7(노드 설정 분리), #3(입출력 구분).

## 계층

아래 계층이 위 계층을 필드 단위로 덮어씁니다.

| 순서 | 계층 | 위치 | 내용 |
| --- | --- | --- | --- |
| 1 | `iraf` | 자동 생성 | `.par` 설명, `.hlp`, SPP 소스 분석(`task_schemas.json`)으로 추론한 포트와 파라미터 |
| 2 | `giraf` | `giraf/schemas/*.json` | 저장소에 포함된 검토된 기본값 |
| 3 | `user` | `user-schemas/*.json`, `GIRAF_SCHEMA_DIRS` | 사용자 지정. `user-schemas/`는 저장소에 포함하지 않음 |
| 4 | `workflow` | 워크플로우 문서 | 내보낸 워크플로우에 동봉된 스키마 (예정) |

필드마다 어느 계층에서 왔는지 `schemaProvenance`에 기록합니다. `iraf` 계층에서 온 필드는 기록하지 않습니다.

기존 `GIRAF_TASK_DESCRIPTORS`(v1)는 지금처럼 자동 추론한 포트 전체를 교체하며, v2 계층은 그 위에 적용됩니다. 스키마 파일의 해시는 작업의 `schemaFiles`에 들어가므로, 검증 후 스키마가 바뀌면 실행 전에 목록을 새로고침하라는 오류가 납니다.

## 파일 형식

작업 하나당 파일 하나를 둡니다. 파일 이름은 자유이며, 작업은 `task` 필드로 지정합니다.

```json
{
  "version": 2,
  "task": "noao.digiphot.daophot.phot",
  "title": "phot",
  "description": "aperture photometry",
  "inputs": {
    "coords": { "kind": "text", "label": "좌표 파일" },
    "skyfile": null
  },
  "outputs": {
    "output": { "default": "phot.mag" }
  },
  "parameters": {
    "verify": { "fixed": "no" },
    "datapars.fwhmpsf": { "label": "FWHM (pixel)", "default": 3.0 }
  },
  "groups": [
    { "label": "측광 반경", "parameters": ["photpars.aperture", "fitskypars.annulus", "fitskypars.dannulus"] }
  ],
  "components": []
}
```

### 덮어쓰기 규칙

- `inputs`, `outputs`, `parameters`는 이름을 키로 하는 객체입니다. 같은 키의 필드만 덮어쓰고, 적지 않은 필드는 아래 계층 값을 유지합니다.
- 포트에 `null`을 주면 포트를 제거하고 일반 파라미터로 되돌립니다.
- 아래 계층에 없는 포트 이름을 쓰면 해당 파라미터를 포트로 만듭니다. 이때는 `kind`가 필요합니다.
- `groups`와 `components`는 목록 전체를 교체합니다.
- `title`, `description`은 값을 교체합니다.

### 포트 필드

| 필드 | 입력 | 출력 | 설명 |
| --- | --- | --- | --- |
| `kind` | ✓ | ✓ | `image`, `text`, `mask`, `metacode`, `binary`. 입력은 `any`(모든 종류)도 가능. GIRAF 노드는 `image-list`도 가능 |
| `label` | ✓ | ✓ | 표시 이름 |
| `multiple` | ✓ | | 여러 파일 입력 |
| `required` | ✓ | | 필수 입력 |
| `sources` | ✓ | | 입력을 받는 방법의 목록. 생략하면 지금처럼 모두 허용 |
| `mode` | | ✓ | `single` 또는 `each`(입력마다 출력). GIRAF 노드는 `pass` |
| `from` | | ✓ | `pass` 출력이 파일을 받아 넘기는 입력 이름 |
| `default` | | ✓ | 기본 출력 이름 또는 접두사 |
| `optional` | | ✓ | 이름을 입력했을 때만 생성 |

`sources`의 값은 다음과 같습니다. 목록에 없는 방법은 설정 탭과 캔버스에서 사라지고, 실행 전 검증에서 거부합니다.

| 값 | 입력 방법 |
| --- | --- |
| `files` | 파일 선택기로 고른 파일 |
| `expression` | IRAF 표현식 |
| `node` | 다른 노드의 출력 연결. 없으면 캔버스의 입력 연결점이 없음 |
| `text` | 직접 입력한 텍스트 (imalign `coords`·`shifts` 같은 표) |
| `cursor` | 커서 명령 기록 (커서 parameter) |

`pass` 출력은 `from` 입력에 들어온 파일 중 자기 `kind`인 파일을 그대로 넘깁니다. 이름을 입력받지 않으며 해당 종류의 파일이 있을 때만 포트로 나타납니다. 가장 먼저 나타난 포트가 기본 출력입니다.

### 파라미터 필드

pset 파라미터는 `datapars.fwhmpsf`처럼 pset 이름을 앞에 붙입니다. 작업 자체의 파라미터는 이름만 씁니다.

| 필드 | 설명 |
| --- | --- |
| `label` | 설정 탭 표시 이름 |
| `default` | 새 노드의 초기값. 이미 만든 노드의 값은 바꾸지 않음 |
| `fixed` | 실행에 항상 이 값을 사용. 설정 탭에서 숨기고 Info 탭에만 표시 |

### 그룹

`groups`를 지정하면 설정 탭 맨 위에 해당 그룹을 순서대로 표시합니다. 그룹에 넣지 않은 파라미터는 기존처럼 작업·pset·패키지 그룹에 남습니다. 그룹은 표시만 바꾸며, 값은 원래 pset에 저장되고 실행됩니다.

### 구성 요소

`components`는 내장 동작을 불러와 조합합니다. 코드 실행은 지원하지 않습니다. 종류마다 별도 검증 규칙을 둡니다. 구성 요소는 쓰는 곳에 따라 셋으로 나뉩니다.

| 분류 | 쓰는 곳 | 뜻 |
| --- | --- | --- |
| 작업 확장 | IRAF 작업 | IRAF가 실행하는 작업에 GIRAF의 상호작용이나 포트를 붙임 |
| 실행 | GIRAF 노드 | 노드가 작업 하나로 실행될 때 하는 일 |
| 흐름 | GIRAF 노드 | 워크플로 실행기가 해석하는 제어 흐름 |

| 종류 | 분류 | 상태 | 용도 |
| --- | --- | --- | --- |
| `image-cursor` | 작업 확장 | 예정 | 영상을 클릭해 커서 명령으로 측정 (daoedit) |
| `value-output`, `value-input` | 작업 확장 | 예정 | 측정값을 연결선으로 다른 노드의 파라미터에 전달 |
| `ccd-preprocess`, `calibration-groups` | 작업 확장 | 예정 | ccdred 계열 전처리와 보정 그룹 포트 |
| `pass-files` | 실행 | 지원 | `pass` 출력대로 입력 파일을 넘김 |
| `save-files` | 실행 | 지원 | 입력 파일을 노드에서 고른 폴더에 저장. 출력이 없어야 함 |
| `loop`, `branch` | 흐름 | 예정 | 반복, 분기 |

아직 지원하지 않는 종류와 쓰는 곳이 맞지 않는 구성 요소는 오류로 표시합니다.

`save-files` 노드는 출력 탭에서 저장 위치와 같은 이름 처리를 정합니다. 저장 위치는 폴더 선택기로 고르며, 비우면 프로젝트 폴더입니다. 프로젝트 안의 폴더는 상대 경로로 기록하고, 프로젝트 밖 폴더는 워크플로 내보내기에서 제외합니다. 같은 이름이 있으면 첫 점 앞에 번호를 붙이거나(`m67.mag.1` → `m67_1.mag.1`) 덮어씁니다.

### GIRAF 노드

`task`가 `giraf.`로 시작하는 파일은 IRAF 작업을 덮어쓰지 않고 새 노드를 정의합니다. 같은 이름의 파일이 여러 계층에 있으면 IRAF 작업처럼 차례로 덮어씁니다. 실행이나 흐름 구성 요소가 정확히 하나 있어야 하며, IRAF 파라미터가 없으므로 `parameters`와 `groups`는 쓸 수 없습니다. 새 포트에는 `kind`가 필요하고, 출력은 `pass`만 가능합니다.

| 필드 | 설명 |
| --- | --- |
| `title` | 노드 이름. 캔버스와 작업 추가 목록에 표시 |
| `description` | 노드 설명 |
| `icon` | 작업 추가 목록의 아이콘. `file-input`, `folder-down` 중 하나 |

GIRAF 노드는 작업 추가 목록에서 IRAF 패키지 위에 타일로 표시하고, Info 탭에 IRAF 실행 명령어와 도움말을 두지 않습니다. 예: `giraf/schemas/file-input.json`, `giraf/schemas/file-save.json`.

```json
{
  "version": 2,
  "task": "giraf.file_input",
  "title": "파일 입력",
  "description": "선택한 파일을 다른 작업에 전달",
  "icon": "file-input",
  "inputs": { "files": { "kind": "any", "label": "파일", "multiple": true, "required": true, "sources": ["files"] } },
  "outputs": {
    "image": { "kind": "image", "mode": "pass", "from": "files" },
    "list": { "kind": "image-list", "mode": "pass", "from": "files" }
  },
  "components": [{ "type": "pass-files" }]
}
```

### 전용 어댑터 작업

ccdred 계열처럼 전용 어댑터(`task_catalog.py`의 `TASKS`)로 실행하는 작업에는 아직 스키마를 적용하지 않습니다. 스키마 파일이 있으면 경고만 표시합니다. ccdred 계열을 스키마로 옮길 때 지원합니다.

## 변경 적용과 진단

스키마 변경은 자동으로 적용합니다. 문제는 기존 경고·오류 패널로 알리며, 노드나 설정 탭에 별도 표시를 추가하지 않습니다.

| 상황 | 표시 | 대상 |
| --- | --- | --- |
| 표시 필드 변경 | 없음 | |
| 포트가 사라지거나 종류가 바뀌어 연결이 맞지 않음 | 오류 | 연결 |
| 스키마가 가리키는 파라미터나 포트가 IRAF 정의에 없음, 잘못된 `fixed` 값 | 경고. 해당 항목만 무시 | 해당 작업의 노드 |
| 스키마 파일 형식 오류, 지원하지 않는 구성 요소 | 오류. 파일을 고칠 때까지 작업 실행 불가 | 해당 작업의 노드 |
| 노드에 저장된 값이 `fixed` 값과 다름 | 경고. 실행에는 `fixed` 값 사용 | 해당 노드 |

형식 오류는 스키마를 조용히 무시한 채 실행하지 않도록 실행을 막습니다(fail closed). 작업을 식별할 수 없는 파일(JSON 문법 오류, `task` 누락, 없는 작업)은 작업 목록 진단(`catalog.discovery.diagnostics`)에 남깁니다.

## 구현 위치

- `giraf/node_schema.py`: 계층 읽기, 형식 검증, 병합, 출처 기록, GIRAF 노드 정의(`node_definition`)
- `giraf/file_nodes.py`: `pass-files`, `save-files` 실행
- `giraf/task_discovery/definition.py`: 자동 생성 스키마에 계층 적용
- `giraf/task_catalog.py`: 전용 어댑터 작업의 미지원 경고
- `giraf/generic_tasks/validation.py`, `scripts.py`: 작업·pset `fixed` 실행 반영
- `giraf/workflow_diagnostics.py`: 스키마 진단을 노드에 연결
- `web/src/lib/parameter-presentation.ts`: `schemaParameterGroups`, `fixedParameters`
- `web/src/features/inspector/`: 그룹 표시, Info 탭의 고정 파라미터
