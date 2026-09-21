// Contracts written before the inspector simplification implementation.
import { expect, test } from 'bun:test'
import { primaryParameterNames, primaryInputNames, filterParameterGroups } from '../src/lib/parameter-presentation'
import { emptyMap, makeInstance, payloadFor } from '../src/lib/task-map'
import type { Spec, Param, Catalog, Preferences } from '../src/lib/workbench'

const p=(name:string,extra:Partial<Param>={}):Param=>({name,type:'s',default:'',prompt:`Original ${name} help`,choices:[],min:'',max:'',...extra})
const spec:Spec={name:'images.immatch.imcombine',package:'images.immatch',title:'imcombine',adapter:'generic',parameters:['combine','reject','rdnoise','gain','lsigma','hsigma','grow'].map(n=>p(n)),inputs:['input','headers','sigmas','scale','zero','weight'].map(name=>({name,label:`Original ${name} help`,kind:'image',multiple:true})),outputs:[{name:'output',kind:'image',default:'combined.fits'}],output:null,kind:'image',parameterSets:[{name:'$package',task:'images.immatch',parameters:[p('verbose')]}]}
const catalog:Catalog={version:'test',tasks:[spec],ccdproc:{parameters:[],inputs:[]},ccdred:[],exam:{}}
const prefs:Preferences={drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}
const noop=()=>{}

test('imcombine input tab exposes optional files and settings tab exposes tuning',()=>{
 expect(primaryParameterNames(spec)).toEqual(['combine','reject'])
 expect(primaryInputNames(spec)).toEqual(['input','scale','zero'])
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
})
test('identical parameter names in different psets retain unique controls and change callbacks',()=>{
 const changes:string[]=[]
 const groups=['datapars','photpars'].map(id=>({id,label:id,parameters:[p('gain')],values:{gain:id},change:(key:string,value:string)=>changes.push(`${id}.${key}=${value}`)}))
 const filtered=filterParameterGroups(groups,'photpars.gain',false)
 filtered[0].change('gain','3')
 expect(changes).toEqual(['photpars.gain=3'])
})
test('presentation selection and filtering preserve complete execution payload including hidden values and psets',()=>{
 const task=makeInstance(spec,catalog,prefs,'task');task.draft.parameters.rdnoise='15';task.draft.parameters.gain='1.4';task.parameterSets={'$package':{verbose:'yes'}};task.draft.inputs.headers=['header-file']
 const map={...emptyMap(),tasks:[task]},before=payloadFor(map,'task',catalog)
 primaryParameterNames(spec);primaryInputNames(spec);filterParameterGroups([{id:'task',label:spec.name,parameters:spec.parameters,values:task.draft.parameters,change:noop}],'combine',true)
 expect(payloadFor(map,'task',catalog)).toEqual(before)
 expect(before.parameters.rdnoise).toBe('15');expect(before.inputs.headers).toEqual(['header-file']);expect(before.parameterSets['$package'].verbose).toBe('yes')
})
