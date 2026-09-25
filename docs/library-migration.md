# 서버 조회·문서 검증·라우팅·실행 순서

적용 버전은 잠금 파일 기준 TanStack Query 5.103.2, Pydantic 2.13.5,
Starlette 1.6.0입니다. graphlib는 프로젝트가 지원하는 Python 3.12 표준 API를 사용합니다.

## 공식 문서와 적용 방법

- [TanStack Query queryOptions](https://tanstack.com/query/v5/docs/framework/react/guides/query-options):
  조회 키와 요청 함수를 함께 정의합니다. 작업 상세 조회는 폴링, 선택한 실행 기록,
  진단 로그 읽기에서 같은 키를 사용하여 진행 중인 요청을 공유합니다.
- [useQueries](https://tanstack.com/query/v5/docs/framework/react/reference/useQueries):
  중복을 제거한 작업 ID 목록을 조회하고 안정적인 `combine` 함수로 결과를 합칩니다.
  `refetchInterval`은 작업이 종료되면 중단하며, 최초 조회 실패 시에는 다음 주기에 재조회합니다.
- [Query cancellation](https://tanstack.com/query/v5/docs/framework/react/guides/query-cancellation):
  query 함수의 `signal`을 `fetch`에 전달합니다. 취소는 사용자 오류로 기록하지 않습니다.
  워크플로우 변경 전에는 이전 조회를 취소하고, 변경 응답으로 캐시를 갱신합니다.
- [Network mode](https://tanstack.com/query/v5/docs/framework/react/guides/network-mode):
  인터넷 연결이 없어도 로컬 서버에 접근할 수 있도록 `networkMode: "always"`를 설정합니다.
  자동 재시도는 끄고 폴링 주기와 명시적인 다시 시도를 사용합니다.
- [Pydantic models](https://docs.pydantic.dev/latest/concepts/models/) 및
  [strict mode](https://docs.pydantic.dev/latest/concepts/strict_mode/):
  중첩 문서를 `BaseModel`로 검증하며 문자열 숫자 등을 암묵적으로 변환하지 않습니다.
  `extra='allow'`와 `exclude_unset=True`로 기존 문서의 확장 필드와 생략된 필드를 보존합니다.
  가져오는 문서는 기존과 같이 작업 설정을 포함해야 하며, 동일한 기반 모델을 상속해
  필수 필드만 강화합니다. 연결 source는 `kind`로 구분하는 discriminated union입니다.
- [Starlette routing](https://starlette.dev/routing/) 및
  [exceptions](https://starlette.dev/exceptions/):
  `/api` 아래에 명시적 `Route`를 등록하고 허용 메서드를 선언합니다.
  잘못된 메서드는 405, 없는 API는 404 JSON 응답입니다.
  Pydantic 검증 실패는 400이며 `issues[].field`에 중첩 필드 경로를 제공합니다.
  기존 Origin 검사와 파일 응답은 유지합니다.
- [Python 3.12 graphlib](https://docs.python.org/3.12/library/graphlib.html):
  `prepare` → `get_ready` → `done`으로 정렬합니다. 각 준비된 묶음을 입력 노드 순서로
  정렬하여 기존 실행 순서를 보존합니다. `CycleError`는 기존 한국어 오류로 변환합니다.

## 애플리케이션에 남는 책임

초안 편집, 자동 저장 직렬화·복구, 실행 결과의 그래프 반영, 진단 검사 디바운스는
GIRAF의 동작 규칙입니다. 초기 서버 스냅샷은 한 번만 편집기에 반영하며, 조회 갱신이
사용자의 편집 내용을 초기화하지 않습니다. 과거 실행 기록을 열어도 현재 그래프의
결과를 과거 실행 결과로 교체하지 않습니다.

## 검증

구현 전에 회귀 테스트를 작성했습니다. 관련 Python 테스트 44개와 Query·진단 테스트
26개가 통과했고 TypeScript 검사와 프로덕션 빌드도 통과했습니다. 브라우저에서 작업
추가, 자동 저장, 새 탭에서 복원을 확인했으며 콘솔 오류는 없었습니다.

전체 Python 테스트는 125개 중 실패 7개·오류 1개, 전체 프런트엔드 테스트는 169개 중
실패 2개가 남아 있습니다. 변경 전 HEAD를 임시 디렉터리에 풀어 실행했을 때에도
동일한 항목이 실패했습니다. 기존 실패는 IRAF 실행·레거시 API·UI 기대값 관련입니다.
전체 ESLint에도 기존 오류가 남아 있으며 이번 변경으로 새 규칙 위반을 추가하지 않았습니다.
