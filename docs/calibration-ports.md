# 보정 그룹 포트

기존 GIRAF 작업 화면의 Operate 확장입니다. 중성색 작업면, Inter Variable, 청록색 액션과 기존 워크플로우·설정 패널을 따릅니다. 별도 승인 시안이나 전역 시각 체계 변경은 없습니다. 이 문서는 유지보수용 동작 기록이며 화면에 추가할 안내 문구가 아닙니다.

## 연결과 그룹

그룹마다 실제로 독립된 입출력 핸들과 연결을 사용하며, 연결선에는 라벨을 붙이지 않습니다. combine의 주 입력은 일반 원형 핸들과 입력 라벨 옆 Badge로 구분하고, 그룹 출력과 `ccdproc`의 보정 입력은 핸들 안에 그룹 식별자를 표시합니다.

| 작업 | 분할 조건 | 표시 예시 |
| --- | --- | --- |
| `flatcombine` | `subsets=yes`일 때 Filter별 입력·출력 | 입력 Badge와 출력 핸들: `B`, `V` |
| `darkcombine` | Exposure time별 결합을 켰을 때 노출시간별 입력·출력 | 입력 Badge와 출력 핸들: `60s`, `90s` |
| `ccdproc` | 자동 대응 시 flat 보정 입력은 Filter별, dark 보정 입력은 노출시간별; 출력은 두 속성의 조합별 | flat 입력: `B`, `V`; dark 입력: `60s`, `90s`; 출력: `B90`, `V60` |
| `zerocombine` 및 `zero` 보정 | 메타데이터로 분할하지 않음 | 일반 핸들 |

`ccdproc`의 주 `images` 입력은 단일 일반 포트입니다. 출력은 알려진 Filter와 Exposure time 조합별로 나뉩니다. 자동 대응을 켜면 dark 보정 입력은 노출시간별로, flat 보정 입력은 Filter별로 나뉩니다. B와 V 또는 60초와 90초의 연결은 각각 선택·교체할 수 있습니다.

`darkcombine`과 `flatcombine`에 그룹별 주 입력이 있으면 그룹 포트와 선택기만 표시합니다. 같은 파일을 중복으로 요약하는 전체 입력 행은 추가하지 않습니다. 알려진 그룹이 없거나 분할 설정이 꺼져 있으면 일반 입력 포트를 사용합니다.

`portHandle()`은 역할과 그룹을 핸들 ID에 인코딩합니다. 표시 문자열은 식별 키가 아닙니다. `source.group`, `targetGroup`, 출력 포트 정보를 연결에 보존하며, 호환되지 않는 그룹 연결은 거절합니다. 아직 실행하지 않은 노드에서도 입력 메타데이터를 따라 포트를 구성하고, 이를 실행 결과로 취급하지 않습니다.

이전 저장본의 `ccdproc` draft에 `calibration.matching` 옵션이 없어도 저장된 `targetGroup` 연결이 있으면 해당 그룹 입력 핸들과 연결선을 표시합니다. 다중 입력을 허용하는 그룹 포트에 노드를 연결하면 같은 그룹의 기존 소스에 추가합니다. 설정에서 파일을 명시적으로 선택하는 동작은 해당 그룹을 교체하며 다른 그룹은 유지합니다.

## 필터 색상

필터 Badge와 필터를 포함한 그룹 핸들은 shadcn Badge의 `filter` 변형 및 Tailwind 색상 토큰을 사용합니다. U는 violet, B는 blue, V는 emerald, R은 red, I는 amber입니다. 밝은 테마의 배경·글자·경계는 각각 100·800·300 단계, 어두운 테마는 950·200·700 단계를 사용합니다. 미지정 필터와 노출시간만 있는 Badge는 중성색으로 표시합니다. 색상과 함께 필터 문자를 유지하며, 이 의미 색상은 기존 청록색 액션을 대체하지 않습니다.

## 선택과 메타데이터

워크플로우의 설정 패널은 그룹별 소스 선택기를 제공합니다. 파일 또는 노드 출력을 해당 그룹에 지정할 수 있고, Filter·노출시간·단위는 설정 라벨에서 분리해 표시합니다. zero에는 Filter·Exposure time 요약을 추가하지 않습니다.

보이는 포트는 파일 브라우저의 `Frame.filter`와 `Frame.exposure`를 기준으로 구성합니다. `calibration-ports.ts`는 그룹 생성 시 별도의 `calibrationMetadata` 덮어쓰기를 제거합니다. 연결된 그룹은 포트 목록에 보존됩니다. 따라서 표시용 분류와 실제 보정 헤더 검증을 혼동하지 않아야 합니다.

`.list` 자산(`image-list`)은 표시용 그룹 메타데이터를 추론하는 영상 목록에서는 제외하지만, 그룹 소스를 선택할 때 메타데이터 불일치로 버리지 않습니다. 연결에 보존해 백엔드에서 목록을 확장하도록 합니다.

엄격한 자동 대응은 실제 FITS 헤더와 헤더 매핑을 사용합니다. dark는 노출시간, flat은 Filter, 기준 영상은 영상 크기를 검사하며 후보가 없거나 여러 개이면 실패합니다. 파일명으로 헤더를 추정하지 않습니다. 대기 중인 노드 출력의 최종 대응은 실행 후 결정됩니다.

## 확인 근거

- 구현: `web/src/components/task-map-view.tsx`, `task-inspector.tsx`, `calibration-controls.tsx`, `ui/badge.tsx`, `web/src/lib/calibration-ports.ts`, `calibration.ts`, `workflow-flow.ts`, `web/src/index.css`, `giraf/calibration.py`를 확인했습니다.
- [최종 데스크톱 화면](../.impeccable/review/calibration-desktop.png): combine의 원형 입력 핸들과 입력 Badge, B/V·60s/90s 출력 핸들, `ccdproc`의 단일 주 입력·B90/V60 출력, dark 90s/60s와 flat B/V 보정 입력, 그룹별 선택기, 라벨 없는 연결선을 확인했습니다. B는 파랑, V는 초록으로 표시되며 전체 입력 행을 중복 표시하지 않습니다. U/R/I 및 어두운 테마의 색상은 CSS에서 확인했습니다.
- [최종 모바일 화면](../.impeccable/review/calibration-mobile.png): 단일 주 입력 선택기와 dark 90 s/60 s 선택기를 확인했습니다. 화면 아래의 flat 선택기 전체나 상호작용 검증은 이 캡처만으로 주장하지 않습니다.
- 저장된 실제 워크플로우의 사본을 사용한 [필터 연결 화면](../.impeccable/review/existing-workflow-filter-links.png)에서 B/V 연결선 두 개를 확인했습니다. [다중 dark 연결 화면](../.impeccable/review/existing-workflow-multiple-dark.png)은 Dark 1을 Master Dark의 90s 입력에 끌어 연결한 뒤 기존 Dark 2를 유지하는 상태입니다. 브라우저 검증에서 두 SVG 연결선이 확인되었으며, 이 증거는 실제 IRAF 실행 검증을 뜻하지 않습니다.

기존 `DESIGN.md`와 `.impeccable/design.json`은 보존합니다. sidecar의 primary 메타데이터에는 중성색 값이 남아 있지만 현재 CSS와 DESIGN.md는 청록색을 사용합니다. 이 선행 불일치는 이번 국소 문서화에서 수정하지 않습니다.
