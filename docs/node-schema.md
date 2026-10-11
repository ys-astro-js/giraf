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
| `mode` | | ✓ | `single`, `each`(입력마다 출력) 또는 `pass`(입력 파일을 넘김). GIRAF 노드는 `pass`만 |
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

IRAF 작업의 `pass` 출력은 작업이 제자리에서 고친 입력 영상을 넘깁니다(hedit `update=yes`). 작업은 실행 폴더의 사본을 고치고, 그 사본이 입력과 같은 이름(`M67B.fits`)의 결과가 되어 다음 작업으로 갑니다. 원본은 바뀌지 않습니다. 이 출력은 IRAF 파라미터에 묶이지 않으므로 이름이 IRAF 파라미터와 겹치면 안 되고(겹치면 경고 후 무시), `kind`는 `image`, `from`은 영상 입력이어야 합니다. 이런 출력이 있는 작업만 `update=yes`로 실행할 수 있습니다(`verify` 같은 확인 질문은 여전히 `no`). 실행 기록에는 사본마다 바뀐 헤더 키를 `header-diff.json`으로 남기고, 실행 기록의 실행 설정 탭이 키, 변경 전, 변경 후 표로 보여 줍니다. IRAF 영상 커널이 헤더를 쓸 때마다 붙이는 `IRAF-TLM`, `DATE`, `ORIGIN`, `EXTEND`는 표에서 뺍니다. 출력이 `pass`뿐이면 표준 출력(`$stdout`)도 함께 둡니다. 예: `giraf/schemas/imutil-hedit.json`.

```json
{
  "version": 2,
  "task": "images.imutil.hedit",
  "outputs": { "result": { "kind": "image", "mode": "pass", "from": "images", "label": "결과" } },
  "parameters": { "update": { "default": "yes" }, "verify": { "fixed": "no" } }
}
```

전용 어댑터 작업 ccdhedit은 출력 방식 `edit`으로 같은 규칙을 따릅니다. 고친 사본이 입력과 같은 이름의 결과가 되고, 출력 이름 칸은 없습니다.

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

`components`는 내장 동작을 불러와 조합합니다. 코드 실행은 지원하지 않습니다. 종류마다 별도 검증 규칙을 둡니다. 구성 요소는 쓰는 곳에 따라 둘로 나뉩니다.

| 분류 | 쓰는 곳 | 뜻 |
| --- | --- | --- |
| 작업 확장 | IRAF 작업 | IRAF가 실행하는 작업에 GIRAF의 상호작용이나 포트를 붙임 |
| 실행 | GIRAF 노드 | 노드가 작업 하나로 실행될 때 하는 일 |

| 종류 | 분류 | 상태 | 용도 |
| --- | --- | --- | --- |
| `cursor` | 작업 확장 | 지원 | 대화형 실행의 커서 키에 이름과 아이콘을 붙임. `interactive` 파라미터가 없는 작업은 이 구성 요소가 있으면 대화형으로 실행 |
| `image-cursor` | 작업 확장 | 대신함 | `cursor`로 대신함 (daoedit) |
| `value-output` | 작업 확장 | 지원 | 작업의 출력에서 측정값을 읽어 값 출력(마름모 연결점)으로 내보냄 |
| `value-input` | 작업 확장 | 예정 | |
| `ccd-preprocess` | 작업 확장 | 예정 | ccdred 계열 전처리 |
| `pass-files` | 실행 | 지원 | `pass` 출력대로 입력 파일을 넘김 |
| `save-files` | 실행 | 지원 | 입력 파일을 노드에서 고른 폴더에 저장. 출력이 없어야 함 |
| `value-constant` | 실행 | 지원 | 노드에 적은 `이름 = 값` 행을 값 출력으로 내보냄 |
| `value-header` | 실행 | 지원 | 입력 파일 헤더에서 행마다 적은 키워드 값을 읽음 |
| `value-compute` | 실행 | 지원 | `이름 = 식` 행을 IRAF 식으로 계산. 식이 읽는 이름이 값 입력이 됨 |
| `pset` | 실행 | 지원 | IRAF pset 하나를 노드로 꺼냄. pset 출력(둥근 사각 연결점)을 같은 pset을 쓰는 작업의 pset 입력에 연결. 노드에 고정한 파라미터는 값 출력(`value:<파라미터>`)으로도 내보냄 |

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

영상마다 값이 필요하면 작업을 파일마다 나눠 실행합니다([나눠서 실행](#나눠서-실행)). 그룹마다의 값이 같은 그룹으로 나눈 다음 작업에 들어갑니다.

pset 노드의 값 출력은 노드에 저장한 값을 파라미터의 IRAF 타입(r/d는 `real`, i는 `int`, b는 `bool`, 나머지는 `string`)으로 내보냅니다. 그 파라미터에 값이 연결되어 있으면 연결된 값을 그대로 넘깁니다. 고정을 풀면 출력도 사라지므로, 값 출력이 연결된 파라미터는 고정을 풀 수 없습니다.

`value-constant`, `value-header`, `value-compute`, `pset` 노드는 작업으로 실행하지 않습니다. 값은 서버(`giraf/values.py`)가 계산합니다.

- 한 작업만 실행할 때는 클라이언트가 `POST /api/values`로 연결된 값을 받아 파라미터에 넣고 실행합니다. 작업 측정값은 그 작업의 마지막 완료 실행에서 읽습니다.
- 워크플로 실행에서는 서버가 값을 내는 작업을 먼저 실행하고, 받는 작업을 실행하기 직전에 값을 계산합니다. 값 노드의 행과 연결은 실행 요청의 `values`에 함께 보냅니다.
- 파라미터는 값 하나를 받습니다. 나눈 작업은 그룹마다 하나를 받습니다. 값이 여러 개면 계산 노드에서 하나로 모으라는 오류로 실행을 막습니다.
- 계산 식은 IRAF 식(`+ - * / **`, 비교, `&&`, `||`, `!`, `abs`, `sqrt`, `exp`, `log`, `log10`, `nint`, `int`, `real`)에 모음 함수 `mean`, `median`, `min`, `max`, `stddev`, `sum`, `count`를 더한 것입니다. 목록끼리는 원소마다 계산합니다.

연결 형식: 값 연결은 `role: "p:<key>"`, `source: {kind: "pending", taskId, outputRole: "value:<name>"}`이고, pset 연결은 `role: "pset:<pset 이름>"`, `outputRole: "pset"`입니다. pset 노드에 연결한 작업은 실행할 때 그 노드의 pset 값을 씁니다.

### 나눠서 실행

작업은 파일 목록 입력 하나를 그룹으로 나누고 그룹마다 IRAF를 한 번 실행합니다. 강의에서 목록 파일을 손으로 나눠 만들고 목록마다 명령을 한 줄씩 쓰는 일을 GIRAF가 대신합니다. 어떤 작업이든 파일 목록 입력이 있으면 같은 방식으로 나눕니다. 특정 작업을 위한 경로는 없습니다. 설정은 작업의 `draft`에 저장하고 실행 요청의 payload에 함께 보냅니다. IRAF 검증은 이 필드를 읽지 않습니다.

| 필드 | 형식 | 뜻 |
| --- | --- | --- |
| `select` | `{<입력>: {key, values: [값]}}` | 고르기. 입력의 파일 중 실제 헤더 `key` 값이 `values` 중 하나인 파일만 씀. 나누기 전에 적용 |
| `split` | `{input, by: [part]}` | 나눌 입력 하나와 나누는 기준. `by`가 비면 나누지 않음 |
| `pairing` | `{<입력>: rule}` | 나눈 작업의 다른 입력이 그룹마다 받을 파일을 정하는 규칙 |
| `groupValues` | `{<파라미터>: {<그룹 id>: 값}}` | 그룹마다 다른 파라미터 값. pset 파라미터는 `pset.name` |
| `formulas` | `{<파라미터>: <IRAF 식>}` | 같은 작업의 다른 파라미터로 계산하는 값(`3 * fwhmpsf`) |

`part`는 차례로 적용합니다. 앞 기준이 만든 그룹을 다음 기준이 다시 나눕니다.

| part | 그룹 | 그룹 id의 값 | 이름(칩) |
| --- | --- | --- | --- |
| `{key: "<헤더 키워드>"}` | 실제 FITS 헤더 값마다. 모든 값이 수로 읽히면 수로, 아니면 글자로 정렬. `15`와 `15.0`은 같은 그룹 | 값(`15.0`은 `15`) | 값. 키워드가 없는 파일은 `없음` |
| `{per: N}` | 그룹의 파일을 파일 이름 순서로 N개씩. 남는 파일은 마지막 그룹(더 작음) | 순번 `1`, `2` | 파일 범위 `1–5`, `6–7` |
| `{each: true}` | 파일마다 | 파일 이름의 첫 점 앞(`m67b`) | 같음 |

그룹 id는 기준마다의 값을 `/`로 이은 것입니다(`15/1`, `B`). 그룹마다 다른 값과 직접 고른 짝은 이 id로 저장합니다. 편집기(`web/src/lib/splits.ts`)는 파일 목록이 읽어 둔 헤더로 그룹을 미리 보여 주고, 서버(`giraf/splits.py`)는 실행할 때 파일의 헤더를 직접 읽습니다. 두 쪽의 규칙과 id는 같습니다.

**다른 입력.** 그룹마다 이렇게 받습니다.

- 파일이 없거나 하나: 모든 그룹에 그대로(IRAF 목록 규칙).
- 여러 개이고 작업을 나누지 않음: 목록 전체(지금과 같음).
- 여러 개이고 작업을 나눔: 입력의 `pairing` 규칙.

| rule | 그룹이 받는 파일 | 문제 |
| --- | --- | --- |
| `{by: KEY}` | 헤더 KEY가 그룹 파일의 KEY와 같은 후보 하나. 둘 다 수로 읽히면 수로 비교 | 그룹 파일의 KEY 값이 서로 다르거나, 맞는 후보가 없거나 여럿이면 그 그룹 이름을 담은 오류 |
| `{order: true}` | i번째 후보를 i번째 그룹에 | 후보 수와 그룹 수가 다르면 오류 |
| `{iraf: true}` | 후보 전체. IRAF가 고름(ccdproc의 flat 고르기 등) | |
| `{manual: {<그룹 id>: <파일 id>}}` | 그룹마다 직접 고른 파일 | 고르지 않은 그룹이 있으면 오류 |
| 없음 | | 경고 `짝 맞추기를 정하세요`. 실행하지 않으며 짐작하지 않음 |

**출력.** 모든 그룹의 결과가 노드의 출력 하나로 모여 다음 작업으로 갑니다. 그룹이 둘 이상이면 출력 하나를 만드는 출력(`single`, 전용 어댑터의 `combine`, `single`, `text`)의 이름 첫 점 앞에 그룹 접미사를 붙입니다. 접미사는 헤더 값을 이어 쓰고, 순번과 파일 이름은 `-` 뒤에 붙입니다. 순번이나 파일 이름만으로 나누면 그대로 붙입니다(`Dark` + EXPTIME 15, 1번 → `Dark15-1`, `Zero` + N개씩 → `Zero1`, `NGC2420` + FILTER B → `NGC2420B`). 입력마다 만드는 출력(`each`), 넘기는 출력(`pass`), 고친 사본(`edit`)과 `{name}`이 든 이름은 지금처럼 파일마다 이름을 짓습니다. 다음 작업의 나누기와 짝 맞추기는 결과 파일의 실제 헤더를 읽으므로 결과에 따로 붙이는 꼬리표는 없습니다.

**고르기.** 노드의 입력 행에 `Filter` 아이콘과 `SUBSET B`처럼 키워드와 값을 보이고, 인스펙터 입력 아래 `고르기` 칩에서 키워드의 값을 고릅니다. 편집기가 헤더를 모르는 파일은 실행할 때 서버가 판단합니다.

**값.** 값 노드(`value-constant`)도 행마다 그룹별 값을 가질 수 있습니다: `draft.groupValues = {<행 이름>: {<그룹 id>: 값}}`. 그룹 id는 이 값이 닿는(계산, pset 노드를 거쳐서도) 나눈 작업의 그룹입니다. 그 작업의 그룹 실행에서는 자기 그룹의 값을, 그룹 값이 없으면 행의 값을 씁니다. 계산 노드와 pset 노드도 그룹마다 계산합니다. 값 노드는 그 값을 작업처럼 그룹 칩 아래 열로 보여 줍니다. 값 연결의 출처가 같은 id의 그룹으로 나눈 작업이면 그 그룹의 실행에서 값을 읽습니다(daoedit B의 FWHM이 phot B로). 아니면 출처의 실행 전체에서 읽습니다. 식은 값 연결과 그룹마다 다른 값을 넣은 뒤 그룹마다 계산합니다. 식은 IRAF 식이고, 이름은 같은 작업의 파라미터 이름입니다(pset 파라미터도 이름만). `/api/values` 요청의 링크에 `groups: [그룹 id]`를 주면 응답에 그룹마다 `<링크 id>@<그룹 id>`가 더해집니다.

**명령.** `POST /api/task-commands {node, payload, values, pending}`은 실행과 같은 함수로 그룹을 나누고 짝을 맞추고 값을 넣은 뒤 검증한 계획에서 그룹마다 CL 명령 한 줄을 만듭니다(`giraf/commands.py`). 인스펙터의 `명령` 구역이 이것을 보여 줍니다. 여러 파일의 입력은 `@<입력>.list`, 출력은 실행이 붙일 이름이며, IRAF 기본값과 다른 파라미터만 적습니다.

**실행.** 워크플로 실행은 그룹마다 작업 하나(`job`)를 실행하고, 작업 기록에 `manifest.group = {id, name}`과 `manifest.nodeLabel`을 남깁니다. 실행 기록은 노드 이름에 그룹 이름을 붙여(`daoedit B`) 보여 줍니다. 나눈 작업을 혼자 실행하면 작업 하나의 워크플로로 그룹마다 실행합니다.

- 대화형 단계: 워크플로의 작업이 커서를 사람에게서 읽으면(위 `cursor`) 실행이 멈추고 그 작업은 `사용자 입력 대기`가 됩니다. 실행 기록과 위쪽 실행 상태에 작업 이름과 그룹(`daoedit B`)이 나오고, 측정 창이 그 그룹의 영상으로 열립니다. 끝내기 버튼(`finish`)이 실행을 이어 가고 다음 그룹이 같은 방식으로 열립니다. 창을 닫아도 실행은 멈춘 채 기다리며, 실행 상태 캡슐 끝의 `측정 창 열기`로 다시 엽니다. 실행을 그치는 것은 중단뿐입니다. 서버는 기존 대화형 실행처럼 작업의 커서 요청(`interaction.json`, `/api/task-respond`)을 기다리고, 워크플로 상태는 그동안 `waiting`입니다.
- 지난 측정: 그룹마다 완료한 측정을 노드 id와 그룹 이름으로 기억합니다(`giraf/measurements.py`, 데이터 폴더의 `.workflow/measurements.json`, 나누지 않은 작업은 빈 이름). 다음 실행에서 그 그룹의 입력 파일 해시가 같으면 창을 열지 않고 지난 측정의 결과로 새 실행 기록을 만들며, 로그에 `daoedit B 지난 측정 사용`과 파일, 측정 수, 측정 시각을 적습니다. 인스펙터 설정 탭의 `측정` 구역이 그룹별 측정을 보여 주고, `다시 측정`이 고른 그룹(또는 `모든 그룹`)을 지워 다음 실행에서 다시 묻습니다(`GET /api/measurements?instance=`, `POST /api/measurements {instance, rounds}`; 요청과 기록의 필드 이름은 예전 그대로).

**진단.** 설정 문제(키워드 이름, N), 짝을 맞출 수 없는 그룹은 그 노드의 오류이고, 규칙 없이 여러 파일이 들어오는 입력은 경고입니다. 앞 작업이 아직 실행되지 않은 입력은 실행할 때 같은 규칙으로 판단합니다.

**예전 문서.** 반복 영역(`giraf.foreach`, 그 전의 `giraf.for`, `giraf.if`)은 열 때 옮깁니다(`web/src/lib/region-migration.ts`). 영역 안의 작업마다 무엇이 입력을 주는지로 정합니다.

- 영역의 나눌 파일을 받는 작업: 같은 파일을 나누는 바깥 영역의 기준, 그다음 이 영역의 기준이 그 입력의 `split`입니다(`keyword` → `{key}`, `count`(파일 이름 순서) → `{per}`, `each` → `{each}`). 조건 `KEY == "V"`는 그 입력의 `select`가 되고, 값 하나만 남기는 키는 나누기에서 뺍니다.
- 같은 영역 안의 앞 작업에서 받는 작업: 그 입력을 `{each}`로 나눕니다(앞 작업이 그룹마다 파일 하나를 냄).
- 이 영역 안에 든 영역의 작업에서 받는 작업(모으기): 이 영역 기준의 헤더 키워드로 그 입력을 나눕니다.
- 나머지 여러 파일 입력: 같은 나눌 파일에서 온 것(앞 경우의 다른 입력, 같은 파일을 나누던 다른 영역의 결과)은 `{order: true}`, 경계 칩 `…로 짝`은 첫 키워드의 `{by}`, `모두에`는 출처가 나뉜 작업일 때 `{iraf: true}`입니다. 파일 하나인 입력은 규칙이 필요 없습니다.
- 출력 이름의 `{꼬리표}`는 지우고, 그룹 접미사가 기본 이름이 됩니다.
- 값 노드의 필터별 표(`partition`, 행의 `groups`)는 그 노드의 `groupValues`가 됩니다.
- `N번`, 식, 키워드 순서의 N장씩, `KEY == "V"`가 아닌 조건처럼 이렇게 말할 수 없는 영역, 나눌 파일과 이어지지 않은 작업, 영역이 주던 값(`value:<꼬리표>`)을 받던 작업은 풀고 `Instance.migrated`를 붙여 `이전 버전의 나누기 설정을 옮기지 못했습니다. 나누기와 짝 맞추기를 다시 정해 주세요.` 경고를 냅니다. 그 작업의 나누기를 정하면 경고가 사라집니다.
- 옮기기는 작업 정의로 초안을 다듬기 전에 합니다. 작업 목록이 아직 반복 노드를 갖고 있어도 영역 설정을 잃지 않습니다.

`save-files` 노드는 출력 탭에서 저장 위치와 같은 이름 처리를 정합니다. 저장 위치는 폴더 선택기로 고르며, 비우면 프로젝트 폴더입니다. 프로젝트 안의 폴더는 상대 경로로 기록하고, 프로젝트 밖 폴더는 워크플로 내보내기에서 제외합니다. 같은 이름이 있으면 첫 점 앞에 번호를 붙이거나(`m67.mag.1` → `m67_1.mag.1`) 덮어씁니다.

### GIRAF 노드

`task`가 `giraf.`로 시작하는 파일은 IRAF 작업을 덮어쓰지 않고 새 노드를 정의합니다. 같은 이름의 파일이 여러 계층에 있으면 IRAF 작업처럼 차례로 덮어씁니다. 실행 구성 요소가 정확히 하나 있어야 하며, IRAF 파라미터가 없으므로 `parameters`와 `groups`는 쓸 수 없습니다. 새 포트에는 `kind`가 필요하고, 출력은 `pass`만 가능합니다.

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

`cursor`는 작업이 IRAF 커서 모드에서 이미 읽는 키를 처음 쓰는 사람도 따라갈 수 있게 이름 붙입니다. 하나만 둘 수 있습니다. 예: `giraf/schemas/daophot-psf.json`, `daophot-daoedit.json`.

실행이 커서를 사람에게서 읽는지는 이렇게 정합니다. IRAF의 `interactive` 파라미터가 있는 작업(psf)은 그 값을 따릅니다. 없는 작업(daoedit)은 `cursor` 구성 요소가 있고, 커서 파라미터(`*imcur`, `*gcur`)에 기록한 커서 명령이나 파일을 주지 않았을 때 대화형으로 실행합니다. daoedit은 한 실행에서 별마다 `a`를 보내고 `q`로 끝나므로, 표준 출력과 값 출력(`fwhm`, `sky`, `skysigma`)에 측정한 별이 모두 들어갑니다.

영상 창은 제목에 영상 파일, 부제목에 `count`(`측정한 별 3개`)를 보여 줍니다. `graphics.accept`가 없는 작업은 클릭한 별이 IRAF가 다시 영상 커서를 읽을 때 표시로 남습니다. 작업이 지금까지 쓴 표준 출력이 표(`#` 머리줄과 수치 행)이면 영상 아래에 작업 이름, 그룹과 함께 표로 보여 줍니다.

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
- `giraf/splits.py`, `giraf/workflow.py`: 나누기, 짝 맞추기, 출력 이름, 식과 그룹마다의 실행
- `giraf/commands.py`: 검증한 계획의 CL 명령(`/api/task-commands`)
- `web/src/lib/splits.ts`, `web/src/lib/group-values.ts`: 편집기의 그룹 미리보기, 짝, 그룹마다의 값
- `web/src/lib/region-migration.ts`: 예전 문서의 반복 영역 옮기기
- `giraf/measurements.py`: 대화형 단계의 그룹별 측정 기억과 다시 쓰기
- `giraf/values.py`: 값 출력 읽기, 값 노드 계산, 파라미터 값 해석(`/api/values`, 워크플로 실행)
- `web/src/lib/values.ts`: 고정 파라미터, 값과 pset 연결, 값 요청
- `giraf/task_discovery/definition.py`: 자동 생성 스키마에 계층 적용
- `giraf/task_catalog.py`: 전용 어댑터 작업의 미지원 경고
- `giraf/generic_tasks/validation.py`, `scripts.py`: 작업·pset `fixed` 실행 반영
- `giraf/workflow_diagnostics.py`: 스키마 진단을 노드에 연결
- `web/src/lib/parameter-presentation.ts`: `schemaParameterGroups`, `fixedParameters`
- `web/src/features/inspector/`: 그룹 표시, Info 탭의 고정 파라미터
