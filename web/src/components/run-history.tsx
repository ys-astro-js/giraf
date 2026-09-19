import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table"
import { stateLabel } from "@/lib/task-map"
import { taskDisplayName, type Job, type Frame } from "@/lib/workbench"

type Props = { jobs: Job[]; onSelect: (id: string) => void; onOpen: (file: Frame) => void; onCancel: (id: string) => void }
type Detail = { id: string; kind: "log" | "files" | "settings" }
const labels = { log: "로그", files: "결과 파일", settings: "실행 설정" }
function time(id: string) { return /^\d{8}-\d{6}/.test(id) ? `${id.slice(4,6)}/${id.slice(6,8)} ${id.slice(9,11)}:${id.slice(11,13)}:${id.slice(13,15)}` : id }
export function RunHistory({jobs,onSelect,onOpen,onCancel}:Props) {
 const [detail,setDetail]=useState<Detail|null>(null)
 const job=detail ? jobs.find(j=>j.id===detail.id) : undefined
 const show=(j:Job,kind:Detail["kind"])=>{ onSelect(j.id);setDetail({id:j.id,kind}) }
 return <section className="run-tray" aria-label="실행 기록과 로그">
  <header className="tray-header">
   {detail && job ? <>
    <Button size="sm" variant="ghost" onClick={()=>setDetail(null)}><ArrowLeft data-icon="inline-start"/>실행 기록으로</Button>
    <span className="run-detail-title"><strong title={job.task || job.name}>{taskDisplayName(job.name)}</strong><span title={job.id}>{time(job.id)}</span><span>{labels[detail.kind]}</span></span>
   </> : <h2>실행 기록</h2>}
  </header>
  <div key={detail ? `${detail.id}:${detail.kind}` : "list"} className="tray-content scroll-fade scroll-fade-4" tabIndex={0} aria-label={detail ? labels[detail.kind] : "실행 기록 목록"}>
   {!detail ? jobs.length ? <Table className="history-table"><TableHeader><TableRow><TableHead>작업</TableHead><TableHead>상태</TableHead><TableHead>기록 보기</TableHead></TableRow></TableHeader><TableBody>{jobs.map(j=><TableRow key={j.id}>
    <TableCell className="run-name"><span title={j.task || j.name}>{taskDisplayName(j.name)}</span><span className="run-time text-muted-foreground" title={j.id}>{time(j.id)}</span></TableCell>
    <TableCell><Badge variant={j.state==="failed"||j.state==="partial"?"destructive":"secondary"}>{stateLabel(j.state)}</Badge></TableCell>
    <TableCell><div className="flex items-center gap-2">
     <Button size="sm" variant="outline" onClick={()=>show(j,"log")}>로그</Button>
     {!!j.products?.length && <Button size="sm" variant="outline" onClick={()=>show(j,"files")}>{`결과 파일 ${j.products.length}개`}</Button>}
     <Button size="sm" variant="ghost" onClick={()=>show(j,"settings")}>실행 설정</Button>
     {["queued","running","waiting"].includes(j.state) && <Button size="sm" variant="outline" onClick={()=>onCancel(j.id)}>중단</Button>}
    </div></TableCell>
   </TableRow>)}</TableBody></Table> : <p className="py-3">실행 기록이 없습니다.</p>
   : !job ? <p className="py-3">실행 기록을 불러올 수 없습니다.</p>
   : detail.kind==="files" ? <ul className="run-files">{job.products.map(p=><li key={p.id}><Button variant="link" onClick={()=>onOpen(p)}>{p.label}</Button></li>)}</ul>
   : detail.kind==="log" ? <div className="run-detail-content"><pre>{job.log || job.message || "로그가 없습니다."}</pre>{job.outcomes?.map((o,i)=><details key={i}><summary>{o.label}</summary><pre>{o.message}</pre></details>)}</div>
   : <div className="run-detail-content"><pre>{job.commands || "실행 명령이 없습니다."}</pre><details><summary>전체 설정</summary><pre>{JSON.stringify(job.effective || job.manifest,null,2)}</pre></details>{!!job.headerDiff?.length && <Table><TableHeader><TableRow><TableHead>헤더 키</TableHead><TableHead>변경 전</TableHead><TableHead>변경 후</TableHead></TableRow></TableHeader><TableBody>{job.headerDiff.map((r,i)=><TableRow key={i}><TableCell>{r.key}</TableCell><TableCell>{r.before??"없음"}</TableCell><TableCell>{r.after??"삭제됨"}</TableCell></TableRow>)}</TableBody></Table>}</div>}
  </div>
 </section>
}
