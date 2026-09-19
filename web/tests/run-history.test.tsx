import { test, expect } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { RunHistory } from "../src/components/run-history"
import type { Job } from "../src/lib/workbench"
test("history exposes direct per-run actions without global tabs or inline product lists", () => {
 const job = {id:"20260916-010000-test",name:"ccdproc",state:"completed",message:"ccdproc · 완료",products:[{id:"p",label:"output.fits",asset:"image"}],count:1,progress:1} as Job
 const html=renderToStaticMarkup(<RunHistory jobs={[job]} onSelect={()=>{}} onOpen={()=>{}} onCancel={()=>{}} />)
 expect(html).toContain("로그")
 expect(html).toContain("결과 파일 1개")
 expect(html).toContain("실행 설정")
 expect(html).not.toContain('role="tab')
 expect(html).not.toContain("output.fits")
 expect(html).not.toContain("작업 추가")
})
test("empty history gives a single empty state",()=>{
 const html=renderToStaticMarkup(<RunHistory jobs={[]} onSelect={()=>{}} onOpen={()=>{}} onCancel={()=>{}} />)
 expect(html).toContain("실행 기록이 없습니다.")
 expect(html).not.toContain("실행 전")
})
