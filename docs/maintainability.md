# 유지보수 구조 점검

2026-09-26. 백엔드와 프론트엔드의 대형 실행 함수, 화면 컴포넌트, 도메인 모듈 및 스타일시트를 함께 점검했습니다. 기존 동작과 저장 형식은 유지하며 변경 이유에 따라 책임을 분리했습니다.

## 주요 경계

| 영역 | 변경할 위치 |
| --- | --- |
| 앱 구성 | `web/src/App.tsx`에서 상태 소유자와 화면을 직접 연결합니다. 단순 전달만 하던 헤더·캔버스·라이브러리·인스펙터 래퍼는 제거했습니다. |
| 문서와 실행 수명주기 | `web/src/features/workbench/hooks/`에서 저장·복구·전환·실행·조회 경계를 관리합니다. 같은 기능의 대화상자는 `dialogs/`에 있습니다. |
| 작업 인스펙터 | `web/src/features/inspector/`에 있습니다. 입력·출력 탭이 자신이 사용하는 파생값을 계산하고, 제목 편집과 설정 초기화 상태는 해당 컴포넌트가 소유합니다. |
| 워크플로우 캔버스 | `web/src/features/workflow/`에 노드·핸들·그룹 렌더링과 연결·서브플로우 조작을 모았습니다. 컨텍스트와 타입은 렌더러를 역으로 import하지 않습니다. |
| 그래프 도메인 | `web/src/lib/task-map/`의 `model`, `connections`, `runs`, `payload`, `editing`, `inputs`, `sources`에 각 책임을 둡니다. `index.ts`가 기존 `@/lib/task-map` 공개 import 경로를 유지합니다. |
| 라이브러리 | `web/src/features/library/`에 있습니다. 부모의 검색·선택·새로고침 상태에 밀접하게 결합된 탐색 헤더는 `Library.tsx`에 통합했습니다. 실행 기록 UI는 `History.tsx`에 있습니다. |
| 영상과 자료 | `web/src/features/viewer/`, `file-picker/`, `alignment/`에 각 기능의 UI·훅·타입을 함께 둡니다. 이미지 뷰어는 정렬 입력·출력 결과·자료 보기에서 공유합니다. |
| 스타일 | `web/src/styles/` 아래 기능별 폴더로 묶습니다. `index.css`의 import 순서는 기존 cascade를 보존하므로 재정렬하지 않습니다. |
| IRAF 발견 | `giraf/task_discovery/`의 `packages.py`가 파일과 패키지를 찾고, `parameters.py`가 파라미터 참조를 해석하며, `definition.py`가 실행 정의를 구성합니다. |
| SPP 분석 | `giraf/spp_schema/`의 `syntax.py`는 구문, `procedure.py`의 `ProcedureAnalysis`는 프로시저 내부 값 흐름, `analysis.py`의 `SourceAnalysis`는 프로시저 간 탐색과 결과 집계를 담당합니다. |
| 범용 작업 | `giraf/generic_tasks/`에서 요청 검증(`validation.py`), 출력 미리보기(`preview.py`), 실행 수명주기(`execution.py`)를 분리합니다. `inputs.py`는 입력 해석, `preparation.py`는 스테이징과 네이티브 인자 바인딩, `scripts.py`는 CL/PyRAF 스크립트 생성을 담당합니다. CCD 전용 입력 검증은 `giraf/task_inputs.py`에 남겨 별도 정책을 유지합니다. |
| 보정과 사전 검증 | `Reduction.run`은 bias/dark/flat/science 단계를 조합합니다. `model.validate`는 설정·입력·master·결합·재개·매칭·영역 검사를 순서대로 호출합니다. |
| 서버 | 요청 검증과 오류 응답은 `api_contract`, 문서 전환은 `workflow_preferences`, 이미지 계산과 인코딩은 `image_rendering`에 있습니다. |

## 컴포넌트와 폴더의 기준

- `components/ui/`는 공통 UI 기본 요소이며, `components/`에는 여러 기능에서 공유하는 입력·선택·표시 UI를 둡니다.
- `features/<기능>/`에는 해당 기능에 속한 화면과 하위 UI를 둡니다. 파일명에서 기능 접두사를 반복하지 않고 `inspector/InputsTab.tsx`, `viewer/Statistics.tsx`처럼 폴더가 문맥을 제공합니다.
- `ImageViewer`, `InspectorInputSlot`, 그래프의 노드·핸들처럼 실제 반복 사용되는 단위를 컴포넌트로 유지합니다. 기능 전용 탭은 해당 입력·출력·설정의 규칙과 상태를 캡슐화하며 공용 UI로 취급하지 않습니다.
- 부모의 전체 props, 다수의 setter와 파생값을 그대로 전달하기 위한 컴포넌트는 만들지 않습니다. 이번 재검토에서 `WorkbenchHeader`, `WorkbenchCanvas`, `WorkbenchLibrary`, `WorkbenchInspector`, `LibraryNavigation`을 제거했습니다.
- 긴 파일의 줄 수만 줄이기 위해 분리하지 않습니다. 함께 변경되는 상태와 UI는 가까이 두고, 별도 책임을 가진 로직은 명시적인 입력·출력을 가진 훅이나 도메인 함수로 분리합니다.
- 뷰어의 범위 검증·적용·초기화, 좌표 확정, 재시도는 `useViewport`가 상태와 함께 관리합니다. 표시 설정과 좌표 UI는 해당 동작을 호출하며, 내부 오류·적용값 setter나 조회 객체를 조합하지 않습니다.
- `useTaskEditing`은 그래프 편집과 배치에 필요한 여섯 입력만 받습니다. 패널·선택 UI와 오류 표시는 `App`, 작업 기본 설정 저장은 `useDocumentPersistence.saveTaskDefaults`가 담당합니다.

백엔드도 기능별 패키지 안에 관련 구현을 모았습니다. `giraf.task_discovery`, `giraf.spp_schema`, `giraf.generic_tasks`의 공개 함수·클래스 import 경로를 유지하며, 기존 위치에 전달용 모듈을 남기지 않습니다. 범용 작업 패키지의 `__init__.py`는 공개 API만 내보내고, 검증과 실행은 서로의 구현에 의존하지 않습니다. 테스트의 프로세스 실행·파일 해시 mock은 실제 책임을 가진 모듈을 대상으로 합니다.

## 검증

- 상태 경계 후속 수정에서 TypeScript 검사와 프로덕션 빌드가 통과했습니다. `bun test`는 수정 전후 모두 174개 중 173개 통과, `binary and mask outputs retain their role after execution and connect by exact format` 1개 실패로 동일했습니다. 이 실행 결과는 아래 이전 점검 기록과 구분합니다.

- TypeScript 검사 및 프로덕션 빌드 통과. 기존 큰 번들 경고는 남아 있습니다.
- 프론트엔드 195개: 193개 통과, 기존 2개 실패. 변경 전 소스를 복원해 동일한 실패를 확인했습니다. 실패는 pending 결과 오류 문구 기대값과 generic 출력 포트 기대값입니다.
- 백엔드 150개: 142개 통과, 기존 7개 실패·1개 오류. 변경 전과 동일한 PyRAF/IRAF 실행, 처리 정책 및 폐기된 API 기대값 문제입니다.
- 백엔드 패키지 재구성 후에도 전체 150개를 재실행해 동일한 실패 목록을 확인했습니다. 공개 import 경로를 사용하는 기존 호출자와 스키마 자료 읽기, 준비·스크립트 생성·실행 테스트를 함께 검증했습니다.
- 린트는 기존 위반으로 통과하지 않습니다. 변경 전 36건에서 32건으로 감소했으며, 새로 발생한 ref 경계와 훅 의존성 문제는 수정했습니다.
- 임시 작업 폴더와 로컬 브라우저에서 작업 추가, 노드 표시, 입력 펼침, 파일 탐색·선택·반영, 라이브러리 갱신, FITS 미리보기, 이미지 뷰어와 통계 표시를 확인했습니다.
- 컴포넌트 경계 재검토 후 라이브러리 탭 전환·작업 검색·추가, 노드와 인스펙터 표시, 입력·출력·설정 탭, 설정 초기화 진입·취소를 다시 확인했습니다. 전체 프론트엔드 테스트와 빌드를 재실행했고 린트 항목은 직전과 동일합니다.
- 스타일 분리 전후 프로덕션 CSS의 SHA-256이 동일합니다: `44c8a81c91aeca8515a06b51547e340504e94e43e5392c7705538726ac45c919`.
- 테스트 파일의 신규 항목은 최초 구현 전에 작성한 기존 준비·이미지 테스트만 사용했습니다. 이번 후속 수정에서는 이동한 모듈의 기존 테스트 import 경로를 갱신했으며 새 테스트를 추가하지 않았습니다.
