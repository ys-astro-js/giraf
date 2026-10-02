# 작업대 레이아웃 인계 (2026-10-02)

2026-10-02에 작업대를 다시 짰다. "모든 창은 떠 있는 창 + 자체 스냅 모델"은 폐기했다.
giraf의 목적은 워크플로우 구성이고, 창 배치가 사용자의 일이 되면 안 된다. 결정 배경은 메모리
`giraf-dockable-panels`에 있다.

## 구조
```
앱 툴바: leading [+ 작업 추가][실행][되돌리기] · center [폴더›워크플로우/실행 상태][경고·오류][실행 기록] · trailing [파일 열기] [설정]
dockview 격자: 워크플로우 캔버스(고정) | 오른쪽 열(노드 설정 그룹 위, 뷰어 그룹 아래) + 떠 있는 창
하단 실행 기록 패널(dockview 밖): 실행 목록 | 선택한 작업의 로그·산출물·실행 설정
```

- `web/src/features/dock/`
  - `layout.ts`: dockview 격자를 다루는 순수 도우미. 종류(`KINDS`: canvas/inspector/viewer),
    오른쪽 열 그룹(`columnGroups`, 격자 JSON 순서), 새 창이 붙을 자리(`dockTarget`/`dockPosition`),
    열 너비 되돌리기(`fitColumn`), 드롭 허용(`canDrop`), 기본 배치(`buildDefault`), 캔버스 고정(`fixCanvas`).
    `tests/dock-layout.test.ts`가 happy-dom 위의 실제 dockview 격자로 검사한다.
  - `store.ts`: 상태(열 너비 px, 하단 패널 열림·높이 px, 최대화한 그룹)와 동작. 열기(`revealPanel`, 선택을
    따라가는 탭은 `follower`), 잠금(`toggleLock`, `registerLockTarget`), 닫기, 최대화, 분리/붙이기
    (`detachWindow`/`attachWindow`), 하단 패널(`toggleTray`, `resizeTray`), 저장/불러오기(`LAYOUT_VERSION` 6,
    옛 저장값은 무시하고 기본 배치).
  - `DockShell.tsx`: dockview를 `disableAutoResizing`으로 띄우고 ResizeObserver에서 `layoutDock`을 부른다.
    열 분할선을 누르면 `startColumnResize`, 놓으면 그 너비를 저장. 캔버스는 머리글이 숨겨져 있어 탭 막대
    대신 콘텐츠 위에 `canvas-bar`(`WindowBar controls={false}`)를 띄운다.
  - `WindowControls.tsx`: 창 알약(닫기·최대화·분리/오른쪽에 붙이기), `LockControl`, `WindowBar`(창 상단 막대).
  - `WindowToolbar.tsx`, `DockTab.tsx`, `morph.ts`, `motion.ts`, `bars.ts`(`barOwner`: 캔버스는 자기 id로 칸을 가진다).
- `web/src/features/library/`: 툴바 팝오버. `TaskPopover`(검색 우선, 검색어가 없으면 패키지 트리, Enter는
  첫 결과 추가), `FilesPopover`(폴더/실행 산출물, 뷰어로 열기), `SettingsPopover`(테마, 실행 엔진).
  팝오버는 `ToolbarGroup` **안에** 둔다. 밖에 두면 열릴 때 base-ui가 포커스 가드 span을 형제로 넣어
  그룹 합치기 선택자(`.toolbar-slot + .toolbar-slot`)가 끊긴다.
- `web/src/features/file-picker/FileList.tsx`의 `FileTable`: 입력 선택 대화상자, 파일 열기 팝오버,
  하단 패널의 산출물 탭이 함께 쓴다.
- `web/src/features/runs/RunTray.tsx`: 하단 실행 기록 패널. 선택은 `w.selectedJob`. 작업을 실행하면
  그 작업을, 워크플로우를 실행하면 첫 단계를 고르고 패널을 연다(단계가 바뀌면 따라감,
  `useWorkflowExecution`). `useLayout().viewLog(id)`는 패널을 열고 그 작업의 로그 탭을 보여 준다.

## 규칙
- 탭은 같은 종류끼리만: 노드 설정끼리, 뷰어(FITS 뷰어 + IRAF 디스플레이)끼리. 다른 종류 그룹의 가운데,
  캔버스, 열의 옆에는 놓을 수 없다. 열의 위/아래로는 놓을 수 있고, 작업대 오른쪽 끝은 열이 비었을 때만.
  `watchDock`의 `onWillShowOverlay`/`onWillDrop`에서 `canDrop`으로 막는다.
- 그룹이 비면 사라지고 남은 그룹이 열을 채운다. 다시 열면 노드 설정은 위, 뷰어는 아래로 돌아온다.
- 최대화는 작업대 안에서만 한다(앱 툴바는 덮지 않음). 붙은 그룹은 dockview `maximize`이고, 상태의 진실은
  dockview의 `isMaximized()`다. dockview `maximize()`는 떠 있는 그룹에서 아무것도 하지 않으므로,
  떠 있는 창은 작업대를 채웠다가 원래 상자로 돌아오는 자체 처리를 한다.
- 떠 있는 창은 스냅하지 않는다. 막대의 빈 곳(dockview void container를 막대 전체 아래에 깔았음)으로
  옮긴다. 다시 붙이기는 알약 버튼이나 탭 끌기로 한다. 수정키 동작은 만들지 않는다.
- 창 알약의 펼침은 CSS `:hover`/`:has(:focus-visible)`로만 한다. React 포인터 상태로 하면 최대화나 분리로
  창이 DOM에서 옮겨질 때 pointerleave가 오지 않아 펼친 채로 남는다.

## 확인 요령
- 타입 검사 `bun run typecheck`(또는 `npx tsc --noEmit -p tsconfig.app.json`). 루트 `tsc -p .`는 아무것도 검사하지 않는다.
- 테스트 `bun test`. `tests/generic-tasks.test.tsx` 1건은 이 작업 전부터 실패한다. lint 오류도 손대지 않은
  파일(useFilePicker, Inspector, useViewport, useWorkbenchController 등)에 원래 있다.
- 미리보기 `.claude/launch.json`의 `web`. 인앱 브라우저가 가려져 있으면(`document.visibilityState === "hidden"`)
  rAF·ResizeObserver·애니메이션 타임라인이 멈추고 스크린샷도 옛 화면이다. 작업대 크기 변화는
  store 모듈을 `import()`해서 `layoutDock(w, h)`를 직접 부른다. 분할선은 합성 PointerEvent로 끌 수 있다
  (sash에 pointerdown, document에 pointermove/up).
- store 모듈은 HMR 뒤 인스턴스가 갈리니 새로고침 후
  `performance.getEntriesByType('resource')`에서 `features/dock/store.ts` URL을 찾아 `import()`.
- 드롭 제한은 합성 DragEvent(dragstart는 탭에, dragenter/dragover는 대상 `.dv-content-container`에)로
  `.dv-drop-target-selection`이 생기는지 본다.
- 개발 프록시에서 POST가 403 나는 기존 문제로 오류 토스트가 뜬다. 토스트를 DOM에서 지우지 말 것.

## 남은 일
- 한 탭만 있는 떠 있는 창은 탭 막대가 숨겨져 있어서 끌어서는 다시 붙일 수 없다(알약 버튼으로만).
- 다시 붙인 창은 떠 있을 때의 높이로 열에 들어간다.
