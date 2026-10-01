# 도킹 창 작업 인계 (2026-10-01)

창 기반 레이아웃은 어느 정도 안정화되어 main에 들어갔다. 결정 사항과 함정은 메모리
`giraf-dockable-panels`, `giraf-spacing-consistency`에 있다. 먼저 읽을 것.

## 구조
- `web/src/features/dock/`
  - 창 시스템 모델(사용자 결정, 2026-10-01): 작업대 = 바탕화면, 워크플로우 포함 모든 창은 같은 창.
    dockview 격자는 쓰지 않는다(비어 있음). 모든 창이 dockview 떠 있는 그룹이고, 붙은 창의 상자는
    `layout.ts`의 스냅 모델이 픽셀로 계산한다. 격자 비율 분할에 기대다가 크기가 계속 틀어졌던 것을 이걸로
    끊었다. 역할별 기본 자리(`home`)는 없다. 붙은 창은 여백 없이 맞붙고(여백은 사용자가 거부),
    모두 네 변에 같은 1px 테두리를 그리며 이웃과 1px 겹쳐 한 줄이 된다(`tiles`).
  - `layout.ts`: 순수 계산. 영역 left/right(열, 세로로 쌓임)·bottom(그 사이 줄)·center(나머지, 한 축으로
    나뉨). 옆 영역 크기는 px로 고정, 가운데가 차이를 받는다. 창이 다 떠난 옆 영역은 `held`로 자리를
    지키고(다른 창이 넓어지지 않음), 그쪽에 다시 붙거나 가운데를 채우면 풀린다. `tests/dock-layout.test.ts`.
  - `store.ts`: 모델을 떠 있는 그룹 상자에 적용(`layOut`), 창·탭·최소화·전체 화면·저장. 바뀌는 건 붙이기,
    측면 토글, 작업대 크기 변화, 붙은 창 경계 끌기(`followResize`)뿐이고, 창이 떠나거나 닫히면 다른 창은
    그대로. 닫은 창은 `places`의 마지막 자리로 다시 열린다. 전체 화면 중에는 저장하지 않는다.
  - `drag.ts`: 집으면 바로 떠 있는 창(`liftWindow`), 작업대 끝(6px, 위는 24px과 그 위 앱 막대 전체)에
    닿으면 그 영역에 붙기, 위 끝은 가운데 채우기(가운데에 창이 있으면 그 옆에 나란히), 위 끝은
    비어 있는 가운데를 채우기(전체 화면은 버튼으로만), 다른 창 위쪽 막대는 탭 합치기, 붙은 창 막대의
    배치 선택지(`DropPicker.tsx`)는 그 영역 안에서 나란히, Esc는 되돌리기. 미리보기는 `dropBox`로
    실제 놓을 때와 같은 계산. 붙은 창의 dockview 크기 조절 손잡이를 끌면 이웃이 따라온다.
  - `transition.ts`: 배치 변화 애니메이션(틀은 창들 아래, 창은 clip-path로 펼쳐짐). store의 배치 동작은
    `animateLayout`으로 감싸고, 불러오기·프리셋은 `quietly`.
  - `motion.ts`: 탭 모핑과 배치 애니메이션이 함께 쓰는 길이·곡선.
  - `WindowToolbar.tsx`: 패널이 쓰는 `WindowTitle`, `WindowToolbar placement="leading|top|bottom"`.
  - `WindowControls.tsx`: 창 조작 알약(닫기·최소화·전체 화면), 창 상단 막대(`WindowTopBar`),
    잠금(`LockControl`), 최소화 트레이.
  - `bars.ts`: 막대 칸 등록부. 전체 화면인 창은 칸 주인이 `APP`(앱 상단 막대)로 바뀐다.
  - `morph.ts`: 탭 전환 시 막대 모핑(대역 캡슐, WAAPI).
  - `panels.ts`: 창 등록표(`canvas`는 콘텐츠 위주, `scrollUnder`는 목록이 막대 아래로 스크롤).
- `web/src/components/toolbar.tsx`: `ToolbarSpacer`(고정/유연), `ToolbarGroup overflow`, `ToolbarButton prominent`, 넘침 메뉴. 넘침 측정은 `toolbar-overflow.ts`.
- 스타일: `web/src/styles/workbench/dock.css`, `web/src/styles/shared/toolbar.css`.

## 확인 요령
- 타입 검사는 `npx tsc --noEmit -p tsconfig.app.json`(또는 `bun run typecheck`). 루트 `tsconfig.json`은
  참조만 있어서 `tsc -p .`는 아무것도 검사하지 않는다.
- 미리보기 `.claude/launch.json`의 `web`(autoPort). 개발 프록시에서 POST가 403 나는 기존 문제가 있어 오류 토스트가 뜬다. 토스트를 스크립트로 DOM에서 지우지 말 것(React가 무너진다).
- 인앱 브라우저 창이 가려져 있으면 `document.timeline`, rAF, ResizeObserver가 멈추고 스크린샷도 옛 화면이다.
  애니메이션은 `Animation.currentTime`을 옮겨 가며, 레이아웃은 수치로 확인한다. 작업대 크기 변화는
  `api.layout(w, h)` 뒤 `followLayout()`을 불러 흉내 내고, 떠 있는 그룹 안쪽 배치도 멈춰 있으니 시험할
  때는 그룹마다 상자 크기로 `group.api.setSize`를 불러 준다. 배치 애니메이션의 정리는 타이머라 계속 돈다.
- store 모듈은 HMR 뒤 인스턴스가 갈리니 새로고침 후 `performance.getEntriesByType('resource')`에서 `store.ts` URL을 찾아 `import()`.

## 남은 일
- 전체 화면인 창에서 탭 전환 시 앱 막대의 컨트롤은 모핑 없이 바뀐다.
- 한 탭 안의 변화(선택 모드 등)는 기존 툴바 모션을 쓴다. 맨 오른쪽 그룹이 사라질 때는 이웃이 없는데도 오른쪽으로 빠진다.
- `tests/generic-tasks.test.tsx` 1건은 이 작업 전부터 실패한다.
