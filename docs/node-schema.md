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
  "pinned": ["datapars.fwhmpsf"],
  "components": []
}
```

### 덮어쓰기 규칙

- `inputs`, `outputs`, `parameters`는 이름을 키로 하는 객체입니다. 같은 키의 필드만 덮어쓰고, 적지 않은 필드는 아래 계층 값을 유지합니다.
- 포트에 `null`을 주면 포트를 제거하고 일반 파라미터로 되돌립니다.
- 아래 계층에 없는 포트 이름을 쓰면 해당 파라미터를 포트로 만듭니다. 이때는 `kind`가 필요합니다.
- `groups`, `components`, `pinned`는 목록 전체를 교체합니다.
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
| `connectable` | `false`이면 값 연결을 받지 않음. 기본은 모든 파라미터가 IRAF 타입에 맞는 값을 받음 |

### 고정 파라미터

`pinned`는 새 노드에서 노드에 고정해 보여 줄 파라미터 목록입니다(`name` 또는 `pset.name`). 노드는 자기 목록을 `Instance.pinned`에 저장하며, 설정 탭의 고정 버튼으로 바꿉니다. 값이 연결된 파라미터는 항상 고정되어 보입니다. 설정 탭에 없는 파라미터는 경고 후 무시합니다.

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
| `cursor` | 작업 확장 | 지원 | 대화형 실행(`interactive=yes`)의 커서 키에 이름과 아이콘을 붙임. 동작은 추가하지 않음 |
| `image-cursor` | 작업 확장 | 예정 | 영상을 클릭해 커서 명령으로 측정 (daoedit) |
| `value-output` | 작업 확장 | 지원 | 작업의 출력에서 측정값을 읽어 값 출력(마름모 연결점)으로 내보냄 |
| `value-input` | 작업 확장 | 예정 | |
| `ccd-preprocess` | 작업 확장 | 예정 | ccdred 계열 전처리 |
| `pass-files` | 실행 | 지원 | `pass` 출력대로 입력 파일을 넘김 |
| `save-files` | 실행 | 지원 | 입력 파일을 노드에서 고른 폴더에 저장. 출력이 없어야 함 |
| `value-constant` | 실행 | 지원 | 노드에 적은 `이름 = 값` 행을 값 출력으로 내보냄. 키워드 값마다 표로 적으면 꼬리표가 붙은 값 |
| `value-header` | 실행 | 지원 | 입력 파일 헤더에서 행마다 적은 키워드 값을 읽음. 파일의 꼬리표가 값에 붙음 |
| `value-compute` | 실행 | 지원 | `이름 = 식` 행을 IRAF 식으로 계산. 식이 읽는 이름이 값 입력이 됨 |
| `pset` | 실행 | 지원 | IRAF pset 하나를 노드로 꺼냄. pset 출력(둥근 사각 연결점)을 같은 pset을 쓰는 작업의 pset 입력에 연결. 노드에 고정한 파라미터는 값 출력(`value:<파라미터>`)으로도 내보냄 |
| `foreach` | 흐름 | 지원 | 반복 영역. 고른 기준(헤더 키워드, 식, N장씩, 파일마다, N번)의 회차마다 안쪽 작업을 실행 |

아직 지원하지 않는 종류와 쓰는 곳이 맞지 않는 구성 요소는 오류로 표시합니다.

### 값 출력과 값 노드

`value-output`은 작업이 실행에서 만든 값을 내보냅니다. 값은 숫자(또는 문자열)의 목록입니다.

```json
{ "type": "value-output", "name": "fwhm", "kind": "real", "from": "$stdout", "column": "FWHM" }
```

| 필드 | 설명 |
| --- | --- |
| `name` | 값 출력 이름. 노드 출력 행과 연결점 `value:<name>` |
| `kind` | `real`(기본), `int`, `bool`, `string`. 받는 파라미터의 IRAF 타입(r/d, i, b, s/f)과 맞아야 연결됨 |
| `from` | 값을 읽을 출력 이름 |
| `column` | 텍스트 표의 열 이름(`#N` 줄 또는 마지막 `#` 머리줄) 또는 1부터 세는 열 번호. `INDEF` 칸은 건너뜀 |
| `keyword` | 출력 영상마다 읽을 FITS 헤더 키워드. `column`과 함께 쓸 수 없음 |

값에는 그 값이 나온 파일의 꼬리표가 붙습니다. `keyword` 값은 그 출력 영상입니다. `column` 값은 표를 만든 입력 영상입니다. 입력마다 만드는 출력(`mode: each`)은 출력 기록의 `source`가, 영상 하나로 실행한 `single` 출력(daoedit의 표준 출력)은 `sourceInput`이 그 입력입니다. 영상 여러 개를 한 번에 넘긴 `single` 출력의 표는 행이 어느 영상에서 나왔는지 알 수 없어 그 입력들에 공통인 꼬리표만 붙습니다. 영상마다 값이 필요하면 `파일마다` 반복 영역 안에서 실행합니다.

pset 노드의 값 출력은 노드에 저장한 값을 파라미터의 IRAF 타입(r/d는 `real`, i는 `int`, b는 `bool`, 나머지는 `string`)으로 내보냅니다. 그 파라미터에 값이 연결되어 있으면 연결된 값을 그대로 넘깁니다. 고정을 풀면 출력도 사라지므로, 값 출력이 연결된 파라미터는 고정을 풀 수 없습니다.

`value-constant`, `value-header`, `value-compute`, `pset` 노드는 작업으로 실행하지 않습니다. 값은 서버(`giraf/values.py`)가 계산합니다.

- 한 작업만 실행할 때는 클라이언트가 `POST /api/values`로 연결된 값을 받아 파라미터에 넣고 실행합니다. 작업 측정값은 그 작업의 마지막 완료 실행에서 읽습니다.
- 워크플로 실행에서는 서버가 값을 내는 작업을 먼저 실행하고, 받는 작업을 실행하기 직전에 값을 계산합니다. 값 노드의 행과 연결은 실행 요청의 `values`에 함께 보냅니다.
- 파라미터는 값 하나를 받습니다. 꼬리표별 값은 반복 영역의 경계 칩이 `…로 짝`이면 그 회차의 값을 씁니다. 값이 여러 개면 계산 노드에서 하나로 모으라는 오류로 실행을 막습니다.
- 계산 식은 IRAF 식(`+ - * / **`, 비교, `&&`, `||`, `!`, `abs`, `sqrt`, `exp`, `log`, `log10`, `nint`, `int`, `real`)에 모음 함수 `mean`, `median`, `min`, `max`, `stddev`, `sum`, `count`를 더한 것입니다. 목록끼리는 원소마다 계산합니다.

연결 형식: 값 연결은 `role: "p:<key>"`, `source: {kind: "pending", taskId, outputRole: "value:<name>"}`이고, pset 연결은 `role: "pset:<pset 이름>"`, `outputRole: "pset"`입니다. pset 노드에 연결한 작업은 실행할 때 그 노드의 pset 값을 씁니다.

### 흐름 노드: 반복 영역

`foreach` 구성 요소를 가진 GIRAF 노드(`giraf/schemas/foreach.json`)는 캔버스에서 그룹과 같은 컨테이너(반복 영역)로 그립니다. 노드 작업과 그룹은 같은 ID를 쓰고, 그룹에 들어 있는 작업과 영역이 안쪽입니다. 영역은 겹칠 수 있습니다. 화면과 동작의 설계는 [노드 구조 브리프](node-structure-brief.md) 3.5에 있습니다. 흐름 노드는 입력과 출력을 선언하지 않고 경계 연결점도 없습니다. 바깥 연결은 안쪽 작업의 입력 행에, 안쪽 작업의 출력은 바깥 작업에 바로 연결합니다.

설정은 작업의 `draft.flow`에 저장하고 인스펙터의 설정 탭에서 편집합니다.

| 필드 | 뜻 |
| --- | --- |
| `criteria` | 기준 목록. `{keyword}`, `{expression, name}`, `{count, order}`(order는 `name` 또는 키워드), `{each: true}`, `{times}`(N번). 여러 개면 조합마다 한 회차 |
| `split` | 나눌 파일의 출처 `{taskId, outputRole}`. N번만 쓰는 영역은 없음 |
| `condition` | 선택. 나눌 파일 중 이 IRAF 식에 맞는 파일만 들어감 |

연결은 넘는 영역마다 받는 방식을 가집니다: `Connection.flow = { "<영역 id>": { "mode": "all" | "match", "keys": [...] } }`. 나눌 파일의 출처에서 오는 연결은 `나눠서`이고 저장하지 않습니다. 저장하지 않은 그 밖의 연결은 출처의 꼬리표 중 영역 기준과 이름이 같은 것이 있으면 그 키워드들로 `match`, 없으면 `all`입니다.

실행은 서버(`giraf/workflow.py`, `giraf/flows.py`)가 맡습니다. 워크플로 실행 요청의 `flows`에 영역을 보내고, 서버는 안쪽 작업을 회차마다 실행합니다.

- 회차: 나눌 파일을 기준 순서대로 나누고 값 순서대로 자연 정렬합니다(`B 15`, `B 30`, `V 15`). 나눌 파일에 기준과 같은 이름의 꼬리표가 있으면 헤더 대신 꼬리표 값을 씁니다. 회차 이름, 값 목록, 출력 이름과 경고에 쓰는 값은 정수로 읽히면 소수점 없이(`15.0` → `15`), 아니면 앞뒤 공백을 뺀 그대로 씁니다.
- 받기: `나눠서`는 회차의 파일, `match`는 `keys`의 값이 회차 값과 같은 파일(꼬리표가 있으면 꼬리표, 없으면 헤더, 둘 다 수로 읽히면 수로 비교), `all`은 출처의 파일 전체입니다. 값 연결도 같은 규칙으로 회차의 값을 고릅니다.
- 꼬리표: 안쪽 작업의 결과에는 회차 값이 `{이름: 값}`으로 붙고, 겹친 영역의 꼬리표가 합쳐집니다. 꼬리표 이름은 키워드 이름, 식은 `name`, N장씩은 `묶음`, 파일마다는 `파일`, N번은 `회차`입니다.
- 모이기: 영역 밖 작업은 안쪽 작업의 모든 회차 결과를 꼬리표와 함께 받습니다.
- 회차 값: 영역 노드의 값 출력 `value:<꼬리표 이름>`은 안쪽 작업에 그 회차 값을 줍니다.
- 진행: 실행 중인 영역은 워크플로 상태의 `flow: {id, index, total}`로 회차를 알리고, 머리에 `4회 중 2번째`처럼 표시합니다.
- 출력 이름: 안쪽 작업의 출력 이름(`draft.outputs`)에 쓴 `{꼬리표 이름}`은 회차 값으로 바뀝니다(`Dark{EXPTIME}_{묶음}.fits` → `Dark15_1.fits`, `{파일}`은 확장자를 뺀 파일명). 다른 `{...}`는 그대로 둡니다. 미리보기는 첫 회차 값입니다. 회차마다 이름이 같은 출력은 그 작업의 경고 진단으로 알립니다.
- 혼자 실행: 안쪽 작업을 혼자 실행하면 첫 회차의 파일과 값을 씁니다.
- 입력 탭: 안쪽 작업의 입력 탭은 입력마다 받는 방식과 회차별 파일을 보여 줍니다. 모든 회차가 같으면 한 줄(`모든 회차 Zero.fits`), 앞 작업이 아직 실행되지 않았으면 `실행하면 정해집니다`입니다.
- 진단: 기준이 없거나 잘못된 경우(식, 범위, 조건), 나눌 파일이 없는 경우는 영역의 오류입니다. 회차에 맞는 파일이 없거나 `all`인 출처가 영역 기준에 없는 꼬리표로 나뉘어 있으면 칩과 받는 작업의 경고로 알립니다. 맞는 파일이 없는 회차는 그 입력 없이 실행합니다.

`save-files` 노드는 출력 탭에서 저장 위치와 같은 이름 처리를 정합니다. 저장 위치는 폴더 선택기로 고르며, 비우면 프로젝트 폴더입니다. 프로젝트 안의 폴더는 상대 경로로 기록하고, 프로젝트 밖 폴더는 워크플로 내보내기에서 제외합니다. 같은 이름이 있으면 첫 점 앞에 번호를 붙이거나(`m67.mag.1` → `m67_1.mag.1`) 덮어씁니다.

### GIRAF 노드

`task`가 `giraf.`로 시작하는 파일은 IRAF 작업을 덮어쓰지 않고 새 노드를 정의합니다. 같은 이름의 파일이 여러 계층에 있으면 IRAF 작업처럼 차례로 덮어씁니다. 실행이나 흐름 구성 요소가 정확히 하나 있어야 하며, IRAF 파라미터가 없으므로 `parameters`와 `groups`는 쓸 수 없습니다. 새 포트에는 `kind`가 필요하고, 출력은 `pass`만 가능합니다.

| 필드 | 설명 |
| --- | --- |
| `title` | 노드 이름. 캔버스와 작업 추가 목록에 표시 |
| `description` | 노드 설명 |
| `icon` | 작업 추가 목록과 노드 머리글의 아이콘. `file-input`, `folder-down`, `variable`, `file-search`, `calculator`, `repeat`, `list-ordered`, `split`, `sliders-horizontal` 중 하나 |

GIRAF 노드는 작업 추가 목록에서 IRAF 패키지 위에 타일로 표시하고, Info 탭에 IRAF 실행 명령어와 도움말을 두지 않습니다. `pset` 노드는 목록에 두지 않고 설정 탭의 pset 그룹에서 꺼냅니다. 예: `giraf/schemas/file-input.json`, `file-save.json`, `value.json`, `header.json`, `compute.json`, `pset.json`.

```json
{
  "version": 2,
  "task": "giraf.file_input",
  "title": "파일 입력",
  "description": "고른 파일을 넘김",
  "icon": "file-input",
  "inputs": { "files": { "kind": "any", "label": "파일", "multiple": true, "required": true, "sources": ["files"] } },
  "outputs": {
    "image": { "kind": "image", "mode": "pass", "from": "files" },
    "list": { "kind": "image-list", "mode": "pass", "from": "files" }
  },
  "components": [{ "type": "pass-files" }]
}
```

`cursor`는 작업이 IRAF 커서 모드에서 이미 읽는 키를 처음 쓰는 사람도 따라갈 수 있게 이름 붙입니다. 하나만 둘 수 있습니다. 예: `giraf/schemas/daophot-psf.json`.

| 필드 | 설명 |
| --- | --- |
| `image.click` | 영상을 클릭하면 그 위치로 보내는 키. 이 키 뒤에 그래픽 커서가 오면 그 별을 검토 중으로 표시 |
| `image.count` | 영상 창 부제목. `{n}`은 사용한 표시 수 |
| `image.actions` | `{key, label, icon}` 목록. 디스플레이 창 툴바의 아이콘 버튼 |
| `image.finish` | `{label, icon, keys}`. 강조 버튼. `keys`를 다음 요청마다 하나씩 보냄(예: `w`, `q`, 마지막 질문의 `q`) |
| `graphics.title` | 그래픽 플롯 제목 |
| `graphics.accept`, `graphics.reject` | `{key, label, icon}`. 사용(강조)·버리기 버튼. 사용하면 검토 중 표시를 확정 |

`icon`은 `check`, `trash`, `sigma`, `save`, `plus`, `minus`, `refresh`, `list`, `eye`, `x` 중 하나입니다. 툴바는 아이콘 버튼이며 `label`은 툴팁입니다.

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
- `giraf/flows.py`, `giraf/workflow.py`: 컨테이너 설정 검사와 회차 실행
- `web/src/lib/containers.ts`, `web/src/lib/flow-graph.ts`: 컨테이너 포트, 연결 규칙, 실행 요청
- `giraf/values.py`: 값 출력 읽기, 값 노드 계산, 파라미터 값 해석(`/api/values`, 워크플로 실행)
- `web/src/lib/values.ts`: 고정 파라미터, 값과 pset 연결, 값 요청
- `giraf/task_discovery/definition.py`: 자동 생성 스키마에 계층 적용
- `giraf/task_catalog.py`: 전용 어댑터 작업의 미지원 경고
- `giraf/generic_tasks/validation.py`, `scripts.py`: 작업·pset `fixed` 실행 반영
- `giraf/workflow_diagnostics.py`: 스키마 진단을 노드에 연결
- `web/src/lib/parameter-presentation.ts`: `schemaParameterGroups`, `fixedParameters`
- `web/src/features/inspector/`: 그룹 표시, Info 탭의 고정 파라미터
