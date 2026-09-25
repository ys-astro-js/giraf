import { test, expect } from 'bun:test'
import { makeDraft, buildPayload, mergeInputs, plannedOutputs } from '../../web/src/lib/workbench'

const parameter = (name: string, value: string) => ({name, default:value, type:'s', choices:[], prompt:'', min:null, max:null})
const slot = (name: string, multiple = true) => ({name,label:name,multiple,kind:'image',required:true})
const combine = {name:'zerocombine',title:'Bias',package:'noao.imred.ccdred',parameters:[parameter('ccdtype','zero')],inputs:[slot('input')],output:{name:'output',mode:'combine',default:'Zero.fits'},kind:'image'}
const proc = {...combine,name:'ccdproc',inputs:[slot('images'),slot('zero')],parameters:[parameter('zerocor','yes')],output:{name:'output',mode:'each',default:'p'}}
const catalog = {version:'2.18.1',tasks:[combine,proc],ccdproc:{inputs:[slot('zero')],parameters:proc.parameters},ccdred:[],exam:{}}

test('drafts retain empty IRAF parameter values and arbitrary input counts', () => {
  const d=makeDraft(combine,{parameters:{ccdtype:''},inputs:{input:['a','b','c']}})
  expect(d.parameters.ccdtype).toBe('')
  expect(d.inputs.input).toEqual(['a','b','c'])
  expect(d.output.name).toBe('Zero.fits')
})
test('shared calibration selections and settings reach preprocessing tasks', () => {
  const task={...combine,preprocess:true}
  const drafts={zerocombine:makeDraft(task,{parameters:{ccdtype:'',process:'yes'},inputs:{input:['a']}}),ccdproc:makeDraft(proc,{inputs:{zero:['master']}})}
  const payload=buildPayload(task,drafts,catalog,{backend:'cl',mapping:{subset:'FILTER'},instrument:[],packageValues:{verbose:'no'}})
  expect(payload.inputs).toEqual({input:['a'],zero:['master'],instrument:[]})
  expect(payload.parameters.ccdtype).toBe('')
  expect(payload.ccdproc.zerocor).toBe('yes')
})
test('reuse supports append, replacement, deduplication and single-file roles',()=>{
  expect(mergeInputs(['a'],['a','b','c'],true,true)).toEqual(['a','b','c'])
  expect(mergeInputs(['a'],['b','c'],true,false)).toEqual(['b','c'])
  expect(mergeInputs(['a'],['b'],false,true)).toEqual(['b'])
})
test('output planning handles many-to-one, per-image duplicates and subsets',()=>{
  const rows=[{id:'a',label:'one.fits',filter:'B'},{id:'b',label:'one.fits',filter:'V'},{id:'c',label:'three.fits',filter:'B'}]
  expect(plannedOutputs(combine,makeDraft(combine,{inputs:{input:rows.map(r=>r.id)}}),rows).map(p=>p.output)).toEqual(['Zero.fits'])
  expect(plannedOutputs(proc,makeDraft(proc,{inputs:{images:['a','b']}}),rows).map(p=>p.output)).toEqual(['pone.fits','pone.fits'])
  expect(plannedOutputs(proc,makeDraft(proc,{inputs:{images:['a']},output:{name:'nested/한글 결과'}}),rows).map(p=>p.output)).toEqual(['한글 결과.fits'])
  expect(plannedOutputs(combine,makeDraft(combine,{inputs:{input:['a']},output:{name:'결과.fit'}}),rows).map(p=>p.output)).toEqual(['결과.fit'])
  expect(plannedOutputs(combine,makeDraft(combine,{parameters:{subsets:'yes'},inputs:{input:rows.map(r=>r.id)}}),rows).map(p=>p.output)).toEqual(['ZeroB.fits','ZeroV.fits'])
})
test('dry-run and text tasks do not advertise generated FITS files',()=>{
  expect(plannedOutputs(proc,makeDraft(proc,{parameters:{noproc:'yes'},inputs:{images:['a']}}),[]).map(p=>p.output)).toEqual(['ccdproc-results.txt'])
  expect(plannedOutputs({...combine,output:null,kind:'text'},makeDraft(combine),[]).map(p=>p.output)).toEqual(['zerocombine-results.txt'])
})
