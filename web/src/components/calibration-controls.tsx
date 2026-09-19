import {Badge} from "@/components/ui/badge"
import type {CalibrationGroup} from "@/lib/calibration-ports"
import type {ReactNode} from 'react'
import type {Frame,Values} from '@/lib/workbench'
import {metadataItems,type MetadataMode,correctionFlags,correctionRoles,type CalibrationOptions} from '@/lib/calibration'
import {Field,FieldGroup,FieldLabel} from '@/components/ui/field'
import {Switch} from '@/components/ui/switch'
import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from '@/components/ui/table'

export function CalibrationOverview({frames,mode='science'}:{frames:Frame[];mode?:MetadataMode}) {
 if(mode==='zero')return null
 const groups=metadataItems(frames,mode)
 return <div className="calibration-overview">
  {groups.length?<Table><TableHeader><TableRow>
   {mode!=='dark'&&<TableHead>Filter</TableHead>}
   {mode!=='flat'&&<TableHead>Exposure time</TableHead>}
   <TableHead className="text-right">영상</TableHead>
  </TableRow></TableHeader><TableBody>{groups.map((g,i)=><TableRow key={i}>
   {mode!=='dark'&&<TableCell>{g.filter||'미확인'}</TableCell>}
   {mode!=='flat'&&<TableCell>{g.exposure===undefined?'미확인':<span className="calibration-value"><span>{g.exposure}</span><span>s</span></span>}</TableCell>}
   <TableCell className="text-right">{g.count}개</TableCell>
  </TableRow>)}</TableBody></Table>:<p className="text-muted-foreground text-sm">입력 영상을 연결해 주세요.</p>}
 </div>
}
export function CalibrationPortLabel({role,group}:{role?:string;group:CalibrationGroup}) {
 return <span className="calibration-port-label">
  {role&&<span className="calibration-port-role">{role}</span>}
  {'filter' in group&&<Badge variant="filter" data-filter={group.filter || undefined} aria-label="Filter">{group.filter||'미확인'}</Badge>}
  {'exposure' in group&&<span className="calibration-value" aria-label="Exposure time">{group.exposure===null?'미확인':<><span>{group.exposure}</span><span>s</span></>}</span>}
 </span>
}
export function CalibrationControls({task,parameters,changeParameter,slot}:{
 task:string;options:CalibrationOptions|undefined;parameters:Values;frames:Frame[];candidates:Record<string,Frame[]>;pending:Record<string,boolean>;change:(value:CalibrationOptions)=>void;changeParameter:(key:string,value:string)=>void;slot:(role:string)=>ReactNode;connectMaster:(role:string,id:string)=>void;masters:Record<string,{id:string;label:string}[]>;customMapping:boolean;repair?:(role:string)=>void
}) {
 return <section className="inspector-section" aria-label="보정 연결"><h3>보정 연결</h3><FieldGroup>
  {Object.entries(correctionFlags).filter(([role])=>correctionRoles(task).includes(role)).map(([role,flag])=><Field key={role}>
   <Field className="parameter-field"><FieldLabel htmlFor={`cal-${flag}`}>{flag}</FieldLabel><Switch id={`cal-${flag}`} checked={parameters[flag]==='yes'} onCheckedChange={v=>changeParameter(flag,v?'yes':'no')}/></Field>
   {parameters[flag]==='yes'&&slot(role)}
  </Field>)}
 </FieldGroup></section>
}
