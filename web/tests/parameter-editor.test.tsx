// Contracts written before the inspector simplification implementation.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { primaryParameterNames, primaryInputNames, filterParameterGroups } from '../src/lib/parameter-presentation'
import { ParameterHelp, Parameters } from '../src/components/workbench-controls'
import { ParameterEditorFields } from '../src/components/parameter-editor'
import { ParameterTable, TaskInspector } from '../src/components/task-inspector'
import { emptyMap, makeInstance, payloadFor } from '../src/lib/task-map'
import type { Spec, Param, Catalog, Preferences } from '../src/lib/workbench'

const p=(name:string,extra:Partial<Param>={}):Param=>({name,type:'s',default:'',prompt:`Original ${name} help`,choices:[],min:'',max:'',...extra})
const spec:Spec={name:'images.immatch.imcombine',package:'images.immatch',title:'imcombine',adapter:'generic',parameters:['combine','reject','rdnoise','gain','lsigma','hsigma','grow'].map(n=>p(n)),inputs:['input','headers','sigmas','scale','zero','weight'].map(name=>({name,label:`Original ${name} help`,kind:'image',multiple:true})),outputs:[{name:'output',kind:'image',default:'combined.fits'}],output:null,kind:'image',parameterSets:[{name:'$package',task:'images.immatch',parameters:[p('verbose')]}]}
const catalog:Catalog={version:'test',tasks:[spec],ccdproc:{parameters:[],inputs:[]},ccdred:[],exam:{}}
const prefs:Preferences={drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}
const noop=()=>{}
const render=(s=spec,label?:string)=>{const cat={...catalog,tasks:[s]},task=makeInstance(s,cat,prefs,'task');if(label!==undefined)task.label=label;return ['input','output','settings'].map(activeTab=>renderToStaticMarkup(<TaskInspector activeTab={activeTab} catalog={cat} map={{...emptyMap(),tasks:[task]}} task={task} rows={[]} edit={noop} pick={noop} onOpen={noop} onRun={noop} busy={false} error="" onErrorFocus={noop} saveDefaults={noop} onRemove={noop} reorderInput={noop}/>)).join('')}

test('imcombine input tab exposes optional files and settings tab exposes tuning',()=>{
 expect(primaryParameterNames(spec)).toEqual(['combine','reject'])
 expect(primaryInputNames(spec)).toEqual(['input','scale','zero'])
 const html=render()
 expect(html).toContain('설정 검색')
 expect(html).toContain('source-scale')
 expect(html).toContain('source-headers')
 expect(html).not.toContain('main-rdnoise')
 expect(html).not.toContain('고급 IRAF 설정')
})
test('unknown installed tasks retain required and query parameters without dumping hidden parameters',()=>{
 const s={...spec,name:'custom.task',parameters:[p('required',{required:true}),p('query',{mode:'q'}),...Array.from({length:20},(_,i)=>p(`hidden${i}`,{mode:'h'}))]}
 expect(primaryParameterNames(s)).toEqual(['required','query'])
})
test('imalign keeps coordinate inputs but removes its full tuning form from the sidebar',()=>{
 const s={...spec,name:'images.immatch.imalign',inputs:['input','reference','coords','shifts'].map(name=>({name,label:name,multiple:true,kind:'text'})),parameters:[p('boxsize'),p('bigbox'),p('niterate')]}
 expect(primaryInputNames(s)).toEqual(['input','reference','coords','shifts'])
 expect(primaryParameterNames(s)).toEqual([])
})
test('global search finds full scoped names and inactive changed parameters without mutating values',()=>{
 const groups=[{id:'task',label:'ccdproc',parameters:[p('overscan',{default:'no'}),p('order',{default:1})],values:{overscan:'no',order:3},change:noop},{id:'datapars',label:'datapars',parameters:[p('gain',{default:1})],values:{gain:2},change:noop}]
 const before=JSON.stringify(groups)
 expect(filterParameterGroups(groups,'datapars.gain',false).flatMap(g=>g.parameters.map(p=>p.name))).toEqual(['gain'])
 expect(filterParameterGroups(groups,'',true).flatMap(g=>g.parameters.map(p=>p.name))).toEqual(['order','gain'])
 expect(JSON.stringify(groups)).toBe(before)
 const html=renderToStaticMarkup(<ParameterEditorFields groups={groups} query="order" changedOnly={true}/> )
 expect(html).toContain('order')
 expect(html).toContain('value="3"')
 expect(html).not.toContain('datapars')
})
test('identical parameter names in different psets retain unique controls and change callbacks',()=>{
 const changes:string[]=[]
 const groups=['datapars','photpars'].map(id=>({id,label:id,parameters:[p('gain')],values:{gain:id},change:(key:string,value:string)=>changes.push(`${id}.${key}=${value}`)}))
 const filtered=filterParameterGroups(groups,'photpars.gain',false)
 filtered[0].change('gain','3')
 expect(changes).toEqual(['photpars.gain=3'])
 const html=renderToStaticMarkup(<ParameterEditorFields groups={groups} query="" changedOnly={false}/>)
 expect(html).toContain('editor-datapars-gain')
 expect(html).toContain('editor-photpars-gain')
})
test('empty search and no changed parameters give distinct actionable states',()=>{
 const groups=[{id:'task',label:'task',parameters:[p('gain')],values:{gain:''},change:noop}]
 expect(renderToStaticMarkup(<ParameterEditorFields groups={groups} query="" changedOnly/>)).toContain('변경한 파라미터가 없습니다')
 expect(renderToStaticMarkup(<ParameterEditorFields groups={groups} query="unmatched" changedOnly={false}/>)).toContain('검색 결과가 없습니다')
})
test('field descriptions follow controls without disclosure or duplicate required text',()=>{
 for (const type of ['s','b']) {
 const html=renderToStaticMarkup(<ParameterTable parameters={[p('gain',{required:true,type})]} values={{}} scope="test" change={noop}/>)
 expect(html).not.toContain('<details')
 expect(html).not.toContain('<summary')
 expect(html).not.toContain('필수 입력')
 expect(html.match(/Original gain help/g)?.length).toBe(1)
 expect(html).toContain('aria-required="true"')
 expect(html).toContain('aria-describedby="test-gain-description"')
 expect(html.match(/aria-hidden="true">\s*\*/g)?.length).toBe(1)
 expect(html.indexOf('id="test-gain-description"')).toBeGreaterThan(html.indexOf('id="test-gain"'))
 }
})
test('empty descriptions do not repeat required status or field name',()=>{
 const html=renderToStaticMarkup(<ParameterHelp p={p('gain',{required:true,prompt:''})} id="description"/>)
 expect(html).not.toContain('필수 입력')
 expect(html).not.toContain('gain')
 expect(html).not.toContain('<details')
})
test('legacy parameter controls also keep descriptions below controls and one required marker',()=>{
 const html=renderToStaticMarkup(<Parameters parameters={[p('gain',{required:true,type:'b'})]} values={{}} scope="legacy" onChange={noop} all/>)
 expect(html).not.toContain('data-orientation="horizontal"')
 expect(html).not.toContain('필수 입력')
 expect(html.match(/aria-hidden="true">\s*\*/g)?.length).toBe(1)
 expect(html.indexOf('id="legacy-gain-description"')).toBeGreaterThan(html.indexOf('id="legacy-gain"'))
})
test('input and output descriptions follow their controls in the inspector',()=>{
 const html=render({...spec, inputs:[{name:'input',label:'Original input description',kind:'image',multiple:true,required:true}],outputs:[{name:'output',label:'Original output description',kind:'image',default:'combined.fits'}]})
 expect(html.indexOf('Original input description')).toBeGreaterThan(html.indexOf('id="source-input"'))
 expect(html.indexOf('Original output description')).toBeGreaterThan(html.indexOf('id="generic-output-output"'))
 expect(html).not.toContain('필수 입력')
 expect(html).not.toContain('input 도움말')
})
test('presentation selection and filtering preserve complete execution payload including hidden values and psets',()=>{
 const task=makeInstance(spec,catalog,prefs,'task');task.draft.parameters.rdnoise='15';task.draft.parameters.gain='1.4';task.parameterSets={'$package':{verbose:'yes'}};task.draft.inputs.headers=['header-file']
 const map={...emptyMap(),tasks:[task]},before=payloadFor(map,'task',catalog)
 primaryParameterNames(spec);primaryInputNames(spec);filterParameterGroups([{id:'task',label:spec.name,parameters:spec.parameters,values:task.draft.parameters,change:noop}],'combine',true)
 expect(payloadFor(map,'task',catalog)).toEqual(before)
 expect(before.parameters.rdnoise).toBe('15');expect(before.inputs.headers).toEqual(['header-file']);expect(before.parameterSets['$package'].verbose).toBe('yes')
})

test('renamed tasks do not repeat the original command beneath their title',()=>{
 const html=render(spec,'B 필터 합성')
 expect(html).toContain('B 필터 합성')
 expect(html).not.toContain('<code class="node-command"')
 expect(render({...spec,name:'ccdproc',package:'noao.imred.ccdred'},'보정 B 2–5')).not.toContain('<code class="node-command"')
 expect(render(spec,spec.name)).not.toContain('<code class="node-command"')
})
