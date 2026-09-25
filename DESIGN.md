---
name: GIRAF
description: "중성색 작업 환경과 청록색 액션의 시각 체계"
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  primary: "oklch(0.51 0.09 185)"
  primary-foreground: "oklch(0.985 0 0)"
  secondary: "oklch(0.97 0 0)"
  secondary-foreground: "oklch(0.205 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  accent: "oklch(0.97 0 0)"
  accent-foreground: "oklch(0.205 0 0)"
  border: "oklch(0.922 0 0)"
  input: "oklch(0.922 0 0)"
  ring: "oklch(0.51 0.09 185)"
  sidebar: "oklch(0.985 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  dark-background: "oklch(0.145 0 0)"
  dark-foreground: "oklch(0.985 0 0)"
  dark-primary: "oklch(0.76 0.11 185)"
  dark-primary-foreground: "oklch(0.21 0.035 185)"
  dark-secondary: "oklch(0.269 0 0)"
  dark-secondary-foreground: "oklch(0.985 0 0)"
  dark-muted: "oklch(0.269 0 0)"
  dark-muted-foreground: "oklch(0.708 0 0)"
  dark-accent: "oklch(0.269 0 0)"
  dark-accent-foreground: "oklch(0.985 0 0)"
  dark-border: "oklch(1 0 0 / 10%)"
  dark-input: "oklch(1 0 0 / 15%)"
  dark-ring: "oklch(0.76 0.11 185)"
  dark-sidebar: "oklch(0.205 0 0)"
  dark-destructive: "oklch(0.704 0.191 22.216)"
typography:
  body:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
  label:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
  title:
    fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif"
    fontWeight: 600
rounded:
  base: "0.625rem"
  node: "12px"
  control: "8px"
  input: "calc(0.625rem * 2.6)"
  button: "calc(0.625rem * 3)"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.button}"
    height: "36px"
    typography: "{typography.label}"
  input:
    rounded: "{rounded.input}"
    height: "36px"
  workflow-node:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.node}"
    width: "248px"
---

# Design System: GIRAF

## Overview

**Creative North Star: "중성색 작업 환경과 명확한 액션"**

GIRAF는 Pretendard Variable과 Base UI의 중성색 작업 환경을 사용하며 주요 동작과 활성 컨트롤을 청록색으로 표시합니다. 얇은 경계, 정렬, 명확한 폼과 선택 상태로 정보를 구분하며 장식보다 반복 작업의 읽기와 조작을 우선합니다.

**Key Characteristics:**

- 밝고 어두운 테마에 대응하는 중성색 영역
- 짧은 이름과 직접 편집하는 폼
- 선택·초점을 선과 대비로 구별하는 평면 구조

## Colors

Primary는 주요 실행 동작과 켜진 스위치·체크박스에 사용합니다. 눌린 토글과 텍스트 선택은 selection/selection-foreground 토큰의 옅은 청록색 바탕과 대비되는 글자색을 사용합니다. 버튼 hover는 primary-hover로 명시하며 밝은 테마에서는 어둡게, 어두운 테마에서는 밝게 조절합니다. neutral 계열은 바탕·보조 영역·경계·텍스트에 사용합니다. 오류에는 destructive를 사용합니다. 위 OKLCH 값은 `web/src/index.css`의 실제 토큰이며 dark 접두사는 `.dark`의 대응 값입니다. 사용되지 않는 차트와 색상 sidebar-primary 토큰은 이 발췌에서 제외합니다.

**The Semantic Color Rule.** 새 화면도 의미 토큰으로 테마를 따라가며 개별 고정색으로 대비를 재정의하지 않습니다.

## Typography

본문과 제목 모두 Pretendard Variable을 사용합니다. [orioncactus/pretendard v1.3.9 릴리스](https://github.com/orioncactus/pretendard/releases/tag/v1.3.9)의 `Pretendard-1.3.9.zip`에서 받은 `web/variable/woff2/PretendardVariable.woff2` 원본을 `web/src/assets/fonts/`에 저장하고 빌드 결과물에 포함합니다. 라이선스는 `web/public/fonts/Pretendard-LICENSE.txt`에 보관합니다. 컨트롤은 기존 작은 label 크기와 중간 굵기를, 영역 제목은 600 굵기를 사용합니다. 본문 크기는 전역적으로 새로 고정하지 않으며 Base UI 컴포넌트의 기존 크기를 이어갑니다. 입력은 기존 반응형 크기(기본 1rem, md 이상 0.875rem)를 유지합니다.

## Layout

가까운 형제는 작은 간격, 내부 패딩은 중간 간격, 별도 편집 영역은 section 간격으로 구분합니다. 작업 영역은 `min-width:0`과 `min-height:0`, 필요한 영역별 스크롤로 긴 파일명과 많은 항목을 수용합니다. 워크플로 편집기의 구체적 열 너비와 전환은 [surface brief](docs/workflow-editor.md)에 둡니다.

**The Proximity Rule.** 같은 설정의 이름·값·보조 동작은 한 그룹에 둡니다.

## Elevation & Depth

주 화면은 그림자 없이 배경 톤과 얇은 경계로 구분합니다. 선택 노드는 전경 테두리와 추가 outline을 사용합니다. 캔버스 도구는 배경과 경계로 작업면 위에서 읽히게 합니다. 초점은 ring 토큰을 사용하며 기존 Base UI focus ring을 보존합니다.

## Shapes

기존 둥근 버튼·입력과 더 작은 곡률의 작업 노드를 함께 사용합니다. 위 radius 값은 CSS의 실제 배율입니다. 노드 연결점은 원형이며 장식이 아닌 입력/출력 동작을 나타냅니다.

## Components

- **Buttons:** primary 실행, outline 보조 동작, ghost 영역 내 동작을 사용합니다. 기본 높이는 36px, 작은 버튼은 32px입니다. hover, disabled, invalid, focus 상태를 Base UI에서 계승합니다.
- **Inputs:** 기본 높이 36px, 입력 토큰의 절반 불투명도 바탕, 좌우 12px 패딩을 사용합니다. 표현식과 파일명은 같은 직접 편집 문법을 사용합니다.
- **Navigation:** 기존 둥근 tabs를 사용하고 선택한 panel과 활성 상태를 일치시킵니다.
- **Workflow node:** 하나의 task 인스턴스를 나타내는 compact card입니다. 제목, 입력 요약, 결과 접근과 입출력 포트를 묶습니다. 선택은 경계로 표현합니다.
- **Boolean fields:** Base UI switch를 이름과 나란히 배치합니다. 실제 종속 필드를 관련 스위치 가까이에 표시합니다.
- **Status:** 오류나 실행 상태처럼 판단에 필요한 곳에 간결한 텍스트를 사용합니다.

## Do's and Don'ts

### Do:

- Do 기존 의미 토큰과 Base UI 상태·키보드 동작을 사용합니다.
- Do 관련 컨트롤은 가까이, 서로 다른 편집 그룹은 넓게 구분합니다.
- Do 오류와 선택을 색 이외의 텍스트·경계·초점으로도 전달합니다.

### Don't:

- Don't 반복 상태 배지나 안내문으로 편집 화면의 위계를 채우지 않습니다.
- Don't 중성색 작업 영역에 장식용 색상·그라디언트·그림자를 추가하지 않습니다.
- Don't 수업 예시나 특정 보정 순서를 모든 화면의 구조로 고정하지 않습니다.

## UI 표기 규칙

- 개수라는 이유만으로 배지를 붙이지 않습니다. 파일 요약과 선택 동작은 `파일 10개`, `3개 선택`처럼 일반 텍스트로 읽히게 합니다. 목록 그룹의 보조 개수는 배경 없이 낮은 강조도의 숫자로 정렬하고, 판단에 도움이 되지 않는 파라미터 개수는 생략합니다. `CountBadge`는 더 보기의 남은 항목 수와 적용 중인 필터 수에만 사용하며, 기존 shadcn `Badge`의 `secondary` 변형을 따릅니다.
- 이름, 상태, 개수, 단위, 식별자를 가운데점이나 괄호로 이어 붙이지 않습니다. 정보의 역할에 따라 정렬과 간격 또는 줄바꿈으로 구분합니다.
- IRAF task·parameter·pset·입출력 식별자와 선택값은 번역하지 않고 원문을 주 라벨로 표시합니다. 원문 필드 설명은 입력 바로 아래에 항상 표시합니다. 필수 항목은 라벨의 별표로 한 번만 표시합니다. 실행·파일 선택·초기화 같은 앱 동작은 한국어로 명확하게 표시합니다. 단위는 관련 값 옆에 둡니다.
- 파일 검색은 파일명을 검색합니다. 영상 유형, 관측 필터, 노출시간은 별도 필터 컨트롤에서 지정합니다. 검색 초기화와 필터 초기화는 서로의 값을 변경하지 않습니다.
- 과학적 표현식, IRAF 문법, 원문 도움말, 파일명과 저장된 사용자 내용은 그대로 보존합니다.

- 기본 설정과 전체 설정에서 텍스트 입력·선택창은 라벨 → 입력 → 설명의 세로 순서로 표시합니다. 스위치는 라벨과 같은 줄 오른쪽에 두며, 설명은 그 줄 아래에 표시합니다. 이 규칙은 화면 폭에 관계없이 유지합니다. 검색 도구 모음의 필터는 폼 필드와 구분합니다.
