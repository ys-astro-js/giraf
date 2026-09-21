import {test,expect} from 'bun:test'
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
