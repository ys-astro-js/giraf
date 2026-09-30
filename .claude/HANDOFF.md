# 도킹 창 작업 인계 (2026-10-01)

브랜치 `claude/window-based-layout-review-68f4ad`, 마지막 커밋 `5942c48`.
결정 사항과 dockview 함정은 메모리 `giraf-dockable-panels`에 있다. 먼저 읽을 것.

## 코드 위치
- `web/src/features/dock/` — `store.ts`(창·탭·최소화·최대화·떠 있는 창 좌표·배치 저장), `drag.ts`(머리줄 포인터 드래그, dockview DnD는 `disableDnd`로 끔), `WindowControls.tsx`(··· 알약 `WindowPill`, 상단 툴바의 `WindowTray`), `DockTab.tsx`(탭: 잠금·닫기), `DockShell.tsx`, `panels.ts`(창 등록표), `presets.ts`(기본/결과 검토).
- 스타일: `web/src/styles/workbench/dock.css`.
- 미리보기: `.claude/launch.json`의 `web`(5174). 개발 프록시에서는 POST가 출처 검사로 403이 나는 기존 문제가 있다.
- 브라우저 확인 팁: store 모듈은 HMR 후 인스턴스가 갈리니 새로고침 후 테스트. 모듈 직접 접근은 `performance.getEntriesByType('resource')`에서 `store.ts?t=` URL을 찾아 `import()`.

## 사용자 피드백 (다음 할 일)
1. **도킹 상태에서 상하 분할이 안 된다.** 창을 다른 창 위/아래 테두리에 놓아도 위아래로 나뉘지 않는 것으로 보임. `dropTargetAt`/`dockWindow`의 top/bottom 판정(머리줄 아래 기준 `SPLIT_BAND`)과 `moveTo` position 확인.
2. **창 모드(떠 있는 창)끼리 탭으로 합치기가 안 된다.** 현재 `dropTargetAt`이 떠 있는 창을 대상에서 제외함. 떠 있는 창 머리줄 위에 놓으면 합쳐져야 함.
3. **··· 알약이 호버 안 한 상태에서도 창 상단(탭 제목)을 가린다.** 알약 클러스터가 절대 위치로 머리줄을 덮음.
4. **좌·우 사이드바, 하단 바 자리에 여전히 뭔가 고정되어 있다.** dockview 가장자리 그룹(edge group)이 빈 상태여도 자리/흔적을 남기는지, 또는 edge 개념 자체가 사용자 기대(모든 창이 자유롭게 붙는 영역)와 어긋나는지 검토.
5. **창마다 상단바가 항상 보여 답답하다.** 새 방향:
   - 창 상단바를 완전히 투명하게(배경·구분선 없이).
   - 탭은 "탭 바" 형식: 툴바와 비슷한 플로팅 캡슐 디자인이지만 탭으로 동작. 툴바와 달리 **텍스트 레이블**을 보여준다.
   - **탭이 하나뿐이면 탭 바를 보여주지 않는다.**
   - ··· 알약(창 조작)은 유지하되 3번 문제를 함께 해결.

UI 배치가 바뀌는 항목은 사용자 선호대로 목업이나 짧은 확인을 거친 뒤 구현한다(메모리 `giraf-design-collaboration`).
