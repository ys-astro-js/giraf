# 노드 스키마 v2

노드의 입출력 포트, 설정 탭 구성, 고정 파라미터를 코드가 아닌 JSON 스키마로 정합니다. IRAF에서 자동 생성한 스키마 위에 필요한 부분만 덮어씁니다. 관련 이슈: #7(노드 설정 분리), #3(입출력 구분).

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
| `kind` | ✓ | ✓ | `image`, `text`, `mask`, `metacode`, `binary` |
| `label` | ✓ | ✓ | 표시 이름 |
| `multiple` | ✓ | | 여러 파일 입력 |
| `required` | ✓ | | 필수 입력 |
| `mode` | | ✓ | `single` 또는 `each`(입력마다 출력) |
| `default` | | ✓ | 기본 출력 이름 또는 접두사 |
| `optional` | | ✓ | 이름을 입력했을 때만 생성 |

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

`components`는 내장 동작을 불러와 조합합니다. 코드 실행은 지원하지 않습니다. 종류마다 별도 검증 규칙을 둡니다.

| 종류 | 상태 | 용도 |
| --- | --- | --- |
| `image-cursor` | 예정 | 영상을 클릭해 커서 명령으로 측정 (daoedit) |
| `value-output`, `value-input` | 예정 | 측정값을 연결선으로 다른 노드의 파라미터에 전달 |
| `ccd-preprocess`, `calibration-groups` | 예정 | ccdred 계열 전처리와 보정 그룹 포트 |

아직 지원하지 않는 종류는 오류로 표시합니다.

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

- `giraf/node_schema.py`: 계층 읽기, 형식 검증, 병합, 출처 기록
- `giraf/task_discovery/definition.py`: 자동 생성 스키마에 계층 적용
- `giraf/task_catalog.py`: 전용 어댑터 작업의 미지원 경고
- `giraf/generic_tasks/validation.py`, `scripts.py`: 작업·pset `fixed` 실행 반영
- `giraf/workflow_diagnostics.py`: 스키마 진단을 노드에 연결
- `web/src/lib/parameter-presentation.ts`: `schemaParameterGroups`, `fixedParameters`
- `web/src/features/inspector/`: 그룹 표시, Info 탭의 고정 파라미터
