import type { UpdateBridge, UpdateState } from "@/lib/app-update"

// Development only: a pretend desktop update, to see its UI in a browser.
// Turn on with localStorage.setItem("giraf-fake-update", "1"); then the
// settings check runs it, or __girafFakeUpdate("downloading" | "downloaded")
// jumps straight there.

declare global {
  interface Window {
    __girafFakeUpdate?: (state: "downloading" | "downloaded") => void
  }
}

const NOTES = `## 새 기능

- 작업 추가의 '명령'에 IRAF 명령을 붙여 넣으면 노드가 만들어집니다.
- 노드를 선택하고 ⌘C와 ⌘V로 복사해 붙여 넣을 수 있습니다.

## 개선

- 작업 추가의 파일 입력, 파일 저장, 값이 작은 타일 한 줄로 나옵니다.
- Windows에서 실행 기록을 WSL 안에 저장해 작업 실행이 빨라졌습니다. 이전 실행 기록은 \`문서\\GIRAF\`에 그대로 남습니다.
- 작업을 실행해도 아래 실행 기록 패널이 저절로 열리지 않습니다.

## 수정

- 나눈 작업의 출력 탭 결과 목록에 마지막 그룹의 결과만 나오던 문제를 고쳤습니다.
- 업데이트한 뒤 새로 고침해도 이전 화면이 열리던 문제를 고쳤습니다.
`

export function installFakeUpdate() {
  if (!localStorage.getItem("giraf-fake-update")) return
  const listeners = new Set<(state: UpdateState) => void>()
  let state: UpdateState = { state: "idle", current: "1.4.31" }
  let timer: number | undefined
  const set = (next: Omit<UpdateState, "current">) => {
    state = { current: state.current, ...next }
    listeners.forEach((listener) => listener(state))
  }
  const download = (percent: number) => {
    window.clearInterval(timer)
    set({ state: "downloading", version: "1.4.32", notes: NOTES, percent })
    timer = window.setInterval(() => {
      percent = Math.min(100, percent + 100 / 30)
      if (percent < 100) set({ ...state, percent })
      else finish()
    }, 200)
  }
  const finish = () => {
    window.clearInterval(timer)
    set({ state: "downloaded", version: "1.4.32", notes: NOTES })
  }
  const update: UpdateBridge = {
    get: async () => state,
    check: async () => {
      set({ state: "checking" })
      window.setTimeout(() => download(0), 600)
      return state
    },
    install: () => console.info("Fake update: quit and install"),
    onState: (callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
  }
  window.girafShell = { ...window.girafShell, update }
  window.__girafFakeUpdate = (to) => (to === "downloading" ? download(0) : finish())
}
