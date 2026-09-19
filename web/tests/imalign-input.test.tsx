import {test,expect} from 'bun:test'
import {renderToStaticMarkup} from 'react-dom/server'
import {AlignmentInput} from '../src/components/alignment-input'
import {alignmentShift,replaceShift,parsePairs,pickAlignmentStar} from '../src/lib/alignment'
import {makeDraft,type Spec,type Catalog,type Preferences} from '../src/lib/workbench'
import {makeInstance,emptyMap,payloadFor,restoreRun,workflowRequest} from '../src/lib/task-map'
const spec:Spec={name:'images.immatch.imalign',title:'imalign',package:'images.immatch',adapter:'generic',parameters:[],inputs:[],output:null,kind:'image'}
const cat:Catalog={version:'test',tasks:[spec],ccdproc:{parameters:[],inputs:[]},ccdred:[],exam:{}}
const prefs:Preferences={drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}
test('alignment uses reference minus input, preserves row order and rejects invalid numbers',()=>{
 expect(alignmentShift([32,32],[40,27])).toEqual([-8,5])
 expect(replaceShift('0 0\n? ?\n',1,[-8,5],2)).toBe('0 0\n-8 5\n')
 expect(parsePairs('32 32\n12.5 21')).toEqual([[32,32],[12.5,21]])
 expect(parsePairs('NaN 1')).toBeNull();expect(parsePairs('1 2 3')).toBeNull()
})
test('inline alignment inputs and bindings survive workflow, saved drafts and history',()=>{
 const t=makeInstance(spec,cat,prefs,'a')
 t.draft.textInputs={coords:'32 32\n',shifts:'0 0\n-8 5\n'}
 t.draft.alignmentBinding={reference:['ref'],input:['a','b']}
 const map={...emptyMap(),tasks:[t]},p=payloadFor(map,'a',cat)
 expect(p.textInputs).toEqual(t.draft.textInputs)
 expect(p.alignmentBinding).toEqual(t.draft.alignmentBinding)
 expect(makeDraft(spec,t.draft).textInputs).toEqual(p.textInputs)
 expect(workflowRequest(map,cat,'/data').nodes[0].payload.textInputs).toEqual(p.textInputs)
 expect(restoreRun(emptyMap(),{id:'run',manifest:p},cat,prefs).tasks[0].draft.textInputs).toEqual(p.textInputs)
})
test('alignment controls expose direct coordinates, existing file path and unavailable viewer guidance',()=>{
 const html=renderToStaticMarkup(<AlignmentInput name="coords" value="" onChange={()=>{}} fileInput={<span>기존 파일</span>} hasFile={false} frames={[]} reference={undefined} coords=""/> )
 expect(html).toContain('coords');expect(html).not.toContain('기준별 좌표');expect(html).toContain('영상에서 별 선택');expect(html).toContain('기준 영상을 먼저 선택');expect(html).toContain('textarea');expect(html).not.toContain('좌표는 1부터 시작합니다.')
})

// Regression: coords is a list of distinct reference objects; shifts has one row per image.
test('shift picking starts with its own reference star and automatically zeros the reference image',()=>{
 const start=pickAlignmentStar({index:-1,value:'9 9\n9 9\n9 9\n'},[45,18],'ref',['ref','b','c'])
 expect(start.anchor).toEqual([45,18])
 expect(start.index).toBe(1)
 expect(start.value).toBe('0 0\n? ?\n? ?\n')
 const second=pickAlignmentStar(start,[53,13],'ref',['ref','b','c'])
 expect(second.value).toBe('0 0\n-8 5\n? ?\n')
 expect(second.index).toBe(2)
 const third=pickAlignmentStar(second,[42,20],'ref',['ref','b','c'])
 expect(third.value).toBe('0 0\n-8 5\n3 -2\n')
})
test('shift rows follow input order even when reference is elsewhere or separate',()=>{
 const ids=['b','ref','c']
 const start=pickAlignmentStar({index:-1,value:''},[45,18],'ref',ids)
 expect(start.index).toBe(0)
 expect(start.value).toBe('? ?\n0 0\n? ?\n')
 expect(pickAlignmentStar(start,[53,13],'ref',ids).index).toBe(2)
 expect(pickAlignmentStar({...start,index:1},[46,19],'ref',ids).value).toBe('? ?\n0 0\n? ?\n')
 const separate=pickAlignmentStar({index:-1,value:''},[45,18],'ref',['b'])
 expect(separate.value).toBe('? ?\n')
 expect(pickAlignmentStar(separate,[53,13],'ref',['b']).value).toBe('-8 5\n')
 expect(pickAlignmentStar({index:-1,value:''},[45,18],'ref',['ref']).value).toBe('0 0\n')
})
test('shift picker works without inline coords and requires a reference image',()=>{
 for(const coords of ['', '1 2\n20 30\n']) {
  const html=renderToStaticMarkup(<AlignmentInput name="shifts" value="" onChange={()=>{}} fileInput={null} hasFile={false} frames={[{id:'ref',label:'reference'},{id:'b',label:'second'}]} reference={{id:'ref',label:'reference'}} coords={coords}/>)
  expect(html).toContain('같은 별로 이동량 계산')
  expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>같은 별로 이동량 계산/)
  expect(html).not.toContain('첫 번째 기준별')
  expect(html).not.toContain('coords와 별도로')
  expect(html).not.toContain('IRAF가 초기 이동량을 추정')
  expect(html).toContain('이동량 행 순서')
  expect(html).toContain('1. reference')
  expect(html).toContain('2. second')
 }
 const html=renderToStaticMarkup(<AlignmentInput name="shifts" value="" onChange={()=>{}} fileInput={null} hasFile={false} frames={[{id:'b',label:'second'}]} coords="1 2"/>)
 expect(html).toMatch(/<button[^>]* disabled=""[^>]*>같은 별로 이동량 계산/)
})
