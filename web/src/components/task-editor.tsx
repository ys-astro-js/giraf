import { useState } from 'react'
import { FolderOpen, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableHeader, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { taskDisplayName, type Catalog, type Preferences, type Frame, type Job } from '@/lib/workbench'
import { Parameters, Blank, Download, Failure } from '@/components/workbench-controls'
import type { PickerRequest } from '@/features/file-picker/FilePicker'

type Shared = {catalog:Catalog;prefs:Preferences;rows:Frame[];update:(fn:(p:Preferences)=>Preferences)=>void;pick:(request:PickerRequest)=>void}
export function PackageSettings({catalog,prefs,rows,update,pick}:Shared){
  return <div className="@container/parameters flex flex-col gap-6">
    <Parameters parameters={catalog.ccdred} values={prefs.packageValues} scope="package" onChange={(key,value)=>update(p=>({...p,packageValues:{...p.packageValues,[key]:value}}))}/>
    <FieldGroup className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      {Object.entries(prefs.mapping).map(([key,value])=><Field key={key}>
        <FieldLabel htmlFor={`mapping-${key}`}>{key}</FieldLabel>
        <Input id={`mapping-${key}`} value={String(value??'')} onChange={e=>update(p=>({...p,mapping:{...p.mapping,[key]:e.target.value}}))}/>
      </Field>)}
    </FieldGroup>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={()=>pick({slot:{name:'instrument',label:'instrument',multiple:false,kind:'text'},initial:prefs.instrument,apply:ids=>update(p=>({...p,instrument:ids}))})}><FolderOpen data-icon="inline-start"/>instrument</Button>
      {prefs.instrument.length>0&&<><span>{rows.find(r=>r.id===prefs.instrument[0])?.label||'선택됨'}</span><Button variant="ghost" onClick={()=>update(p=>({...p,instrument:[]}))}>해제</Button></>}
    </div>
  </div>
}
export function ResultPanel({job,onOpen,onReuse,onRestore,showName=true}:{showName?:boolean;job?:Job;onOpen:(row:Frame)=>void;onReuse:(rows:Frame[])=>void;onRestore:(job:Job)=>void}){
  const [excluded,setExcluded]=useState<string[]>([])
  if(!job)return <Blank>실행 결과 없음</Blank>
  const running=['queued','running'].includes(job.state),products=job.products||[],images=products.filter(p=>p.role!=='$log'&&p.asset!=='plot')
  const chosen=images.filter(p=>!excluded.includes(p.id)&&(p.asset==='image'||excluded.includes('include:'+p.id)))
  return <div className="flex flex-col gap-6"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3">{showName&&<span title={job.task || job.name}>{taskDisplayName(job.name)}</span>}<Badge variant={job.state==='failed'?'destructive':'secondary'}>{running?'실행 중':job.state==='completed'?'완료':'실패'}</Badge><Badge variant="outline">{job.backend||'PyRAF'}</Badge></div>{products.length>0&&<Button variant="outline" disabled={!chosen.length} onClick={()=>onReuse(chosen)}>다음 입력으로 <ArrowRight data-icon="inline-end"/></Button>}</div>{running&&<Progress value={Math.round((job.progress||0)*100)} aria-label="IRAF 실행 진행"/>}{job.state==='failed'&&<Failure message={job.message}/>}{products.length>0&&<Table><TableHeader><TableRow><TableHead><span className="sr-only">다음 입력 선택</span></TableHead><TableHead>파일</TableHead><TableHead>형식</TableHead><TableHead><span className="sr-only">파일 동작</span></TableHead></TableRow></TableHeader><TableBody>{products.map(p=><TableRow key={p.id}><TableCell>{images.includes(p)&&<Checkbox aria-label={`${p.label} 다음 입력으로 선택`} checked={chosen.some(r=>r.id===p.id)} onCheckedChange={checked=>setExcluded(s=>checked?[...s.filter(id=>id!==p.id),'include:'+p.id]:[...s.filter(id=>id!=='include:'+p.id),p.id])}/>}</TableCell><TableCell><Button variant="link" className="h-auto max-w-full justify-start whitespace-normal break-all px-0" onClick={()=>onOpen(p)}>{p.label}</Button></TableCell><TableCell>{p.asset==='image-list'?'Image list':p.asset==='image'?'FITS':p.asset==='plot'?'SVG':p.asset==='mask'?'Mask':p.asset==='metacode'?'GKI':p.asset==='binary'?'Binary':'Text'}</TableCell><TableCell><Download id={p.id}/></TableCell></TableRow>)}</TableBody></Table>}{job.manifest&&<div><Button variant="outline" onClick={()=>onRestore(job)}>입력과 설정 불러오기</Button></div>}<Accordion multiple defaultValue={job.state==='failed'?['log']:[]}><AccordionItem value="log"><AccordionTrigger>실행 로그</AccordionTrigger><AccordionContent><pre className="max-h-96 overflow-auto">{job.log||job.message}</pre></AccordionContent></AccordionItem><AccordionItem value="commands"><AccordionTrigger>IRAF 명령</AccordionTrigger><AccordionContent><pre className="max-h-96 overflow-auto">{job.commands||'—'}</pre></AccordionContent></AccordionItem></Accordion></div>
}
