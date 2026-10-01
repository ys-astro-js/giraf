# 도킹 창 작업 인계 (2026-10-01)

창 기반 레이아웃은 어느 정도 안정화되어 main에 들어갔다. 결정 사항과 함정은 메모리
`giraf-dockable-panels`, `giraf-spacing-consistency`에 있다. 먼저 읽을 것.

## 구조
- `web/src/features/dock/`
  - `store.ts`: 창·탭·최소화·최대화(= 전체 화면)·배치 저장. 가장자리 그룹 없이 한 격자.
    측면 토글은 그쪽 끝에 붙은 창을 숨기고 보인다. 창 요소에 `data-tabbed`(탭 여럿),
    `data-fullscreen`(최대화)을 붙이고 dock.css가 이것으로 막대 모양을 정한다.
  - `drag.ts`: 머리줄 빈 곳으로 창 끌기, 탭 끌기(dockview DnD는 끔). 영역 방식: 끄는 동안 배치는
    그대로, 창 가운데 40%는 탭 합치기, 나머지는 가까운 쪽에 나란히, 목표는 140ms 머물러야 바뀜,
    Shift는 떠 있는 창, 목표 없음·Esc는 취소.
  - `transition.ts`: 배치 변화 애니메이션. store의 배치 동작은 `animateLayout`으로 감싸고, 불러오기·
    프리셋은 `quietly`. 틀은 창들 아래(`.dv-grid-view` 배경 투명), 창은 clip-path로 펼쳐짐.
  - `sizes.ts`: 옆 창의 픽셀 크기 유지. dockview는 비율로만 나누고 바뀔 때마다 비율을 다시 저장해서
    크기가 변해 갔다. 작업대 크기가 바뀌면(ResizeObserver) 되돌리고, 그 밖의 배치 변화는 기록한다.
    최대화 중에는 배치를 저장하지 않는다(새로고침하면 최대화 전 배치로).
  - `motion.ts`: 탭 모핑과 배치 애니메이션이 함께 쓰는 길이·곡선.
  - `WindowToolbar.tsx`: 패널이 쓰는 `WindowTitle`, `WindowToolbar placement="leading|top|bottom"`.
  - `WindowControls.tsx`: 창 조작 알약(닫기·최소화·최대화), 창 상단 막대(`WindowTopBar`),
    잠금(`LockControl`), 최소화 트레이.
  - `bars.ts`: 막대 칸 등록부. 최대화한 창은 칸 주인이 `APP`(앱 상단 막대)로 바뀐다.
  - `morph.ts`: 탭 전환 시 막대 모핑(대역 캡슐, WAAPI).
  - `panels.ts`: 창 등록표(`canvas`는 콘텐츠 위주, `scrollUnder`는 목록이 막대 아래로 스크롤).
- `web/src/components/toolbar.tsx`: `ToolbarSpacer`(고정/유연), `ToolbarGroup overflow`, `ToolbarButton prominent`, 넘침 메뉴. 넘침 측정은 `toolbar-overflow.ts`.
- 스타일: `web/src/styles/workbench/dock.css`, `web/src/styles/shared/toolbar.css`.

## 확인 요령
- 미리보기 `.claude/launch.json`의 `web`(autoPort). 개발 프록시에서 POST가 403 나는 기존 문제가 있어 오류 토스트가 뜬다. 토스트를 스크립트로 DOM에서 지우지 말 것(React가 무너진다).
- 인앱 브라우저 창이 가려져 있으면 `document.timeline`, rAF, ResizeObserver가 멈추고 스크린샷도 옛 화면이다.
  애니메이션은 `Animation.currentTime`을 옮겨 가며, 레이아웃은 수치로 확인한다. 작업대 크기 변화는
  `api.layout(w, h)` 뒤 `followLayout()`을 불러 흉내 낸다. 배치 애니메이션의 정리는 타이머라 계속 돈다.
- store 모듈은 HMR 뒤 인스턴스가 갈리니 새로고침 후 `performance.getEntriesByType('resource')`에서 `store.ts` URL을 찾아 `import()`.

## 남은 일
- 최대화한 창에서 탭 전환 시 앱 막대의 컨트롤은 모핑 없이 바뀐다.
- 한 탭 안의 변화(선택 모드 등)는 기존 툴바 모션을 쓴다. 맨 오른쪽 그룹이 사라질 때는 이웃이 없는데도 오른쪽으로 빠진다.
- `tests/generic-tasks.test.tsx` 1건은 이 작업 전부터 실패한다.
