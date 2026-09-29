// Node schema v2 presentation: display groups and fixed values (docs/node-schema.md).
import { expect, test } from 'bun:test'
import { fixedParameters, schemaParameterGroups, type ParameterGroup } from '../src/lib/parameter-presentation'
import type { Param, Spec, Values } from '../src/lib/workbench'

const p=(name:string):Param=>({name,type:'r',default:1,prompt:name,choices:[],min:'',max:''})
const base:Spec={name:'noao.digiphot.daophot.phot',package:'noao.digiphot.daophot',title:'phot',adapter:'generic',parameters:[p('sigma'),p('zmag')],inputs:[],outputs:[],output:null,kind:'text',
 parameterSets:[{name:'datapars',task:'daophot.datapars',parameters:[p('fwhmpsf'),p('epadu')],fixed:{itime:90}},{name:'photpars',task:'daophot.photpars',parameters:[p('aperture')]}],
 fixed:{verify:'no'},schemaProvenance:{'parameters.datapars.itime.fixed':'user'}}
function groups(changes:string[]):ParameterGroup[]{
 const group=(id:string,params:Param[],values:Values)=>({id,label:id,parameters:params,values,change:(k:string,v:string)=>changes.push(`${id}:${k}=${v}`)})
 return [group('task',base.parameters,{sigma:22}),group('set-datapars',base.parameterSets![0].parameters,{fwhmpsf:7.5}),group('set-photpars',base.parameterSets![1].parameters,{})]
}

test('without schema groups the default task and pset groups are unchanged',()=>{
 const g=groups([])
 expect(schemaParameterGroups(base,g)).toBe(g)
})

test('schema groups gather task and pset parameters and write back to their owners',()=>{
 const changes:string[]=[]
 const spec={...base,groups:[{label:'측광',parameters:['datapars.fwhmpsf','photpars.aperture','sigma','absent']}]}
 const shown=schemaParameterGroups(spec,groups(changes))
 expect(shown.map(g=>g.label)).toEqual(['측광','task','set-datapars'])
 expect(shown[0].parameters.map(q=>q.name)).toEqual(['datapars.fwhmpsf','photpars.aperture','sigma'])
 expect(shown[0].values).toEqual({'datapars.fwhmpsf':7.5,'photpars.aperture':undefined,sigma:22})
 expect(shown[1].parameters.map(q=>q.name)).toEqual(['zmag'])
 shown[0].change('datapars.fwhmpsf','8')
 shown[0].change('sigma','20')
 expect(changes).toEqual(['set-datapars:fwhmpsf=8','task:sigma=20'])
})

test('fixed values list task and pset entries with their schema layer',()=>{
 expect(fixedParameters(base)).toEqual([
  {name:'verify',value:'no',source:'작업 정의'},
  {name:'datapars.itime',value:'90',source:'사용자'},
 ])
})
