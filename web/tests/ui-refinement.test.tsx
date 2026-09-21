// Written before the UI refinement implementation.
import { expect, test } from 'bun:test'
import { pixelPosition, stepPixel, displayNumber, rangeValue, revealOffset, anchoredZoom } from '../src/lib/viewer-navigation'

const bounds={width:2048,height:1024}
test('pixel coordinates are 1-based integers and reject invalid values',()=>{
 expect(pixelPosition('2048','1024',bounds)).toEqual({x:2048,y:1024})
 for(const [x,y] of [['','1'],['0','1'],['1.5','2'],['2049','1'],['NaN','1'],['1','1025']]) expect(pixelPosition(x,y,bounds)).toBeNull()
})
test('arrow navigation follows FITS Y axis and clamps at image edges',()=>{
 expect(stepPixel({x:1,y:1},'ArrowUp',bounds)).toEqual({x:1,y:2})
 expect(stepPixel({x:1,y:1},'ArrowLeft',bounds)).toEqual({x:1,y:1})
 expect(stepPixel({x:2048,y:1024},'ArrowRight',bounds)).toEqual({x:2048,y:1024})
 expect(stepPixel(null,'ArrowUp',bounds)).toEqual({x:1024,y:513})
 expect(stepPixel({x:1,y:20},'ArrowDown',bounds,10)).toEqual({x:1,y:10})
})
test('compact range presentation preserves untouched precision and tiny values',()=>{
 const value=3538.146750488281
 expect(displayNumber(value)).toBe('3538.14675')
 expect(rangeValue(displayNumber(value),value)).toBe(value)
 expect(rangeValue('3500',value)).toBe(3500)
 expect(rangeValue('',value)).toBeNaN()
 expect(Number(displayNumber(1.23456789e-10))).toBeGreaterThan(0)
})
test('selected nodes reveal minimally and oversized nodes keep their heading visible',()=>{
 expect(revealOffset({x:50,y:40,width:100,height:80},{x:0,y:0,width:400,height:300})).toEqual({x:0,y:0})
 expect(revealOffset({x:450,y:40,width:100,height:80},{x:0,y:0,width:400,height:300})).toEqual({x:166,y:0})
 expect(revealOffset({x:100,y:400,width:500,height:600},{x:0,y:0,width:400,height:300})).toEqual({x:84,y:384})
})

// Pointer anchoring and clamped zoom behavior, specified before implementation.
test('zoom preserves the image point under its anchor, including limits',()=>{
 const view={width:1000,height:600}, anchor={x:730,y:180}, pan={x:40,y:-20}
 for(const factor of [1.25,0.8,1000,0.00001]) {
  const next=anchoredZoom(2,pan,anchor,view,factor)
  expect(next.scale).toBeGreaterThanOrEqual(0.1)
  expect(next.scale).toBeLessThanOrEqual(32)
  expect((anchor.x-view.width/2-next.pan.x)/next.scale).toBeCloseTo((anchor.x-view.width/2-pan.x)/2,10)
  expect((anchor.y-view.height/2-next.pan.y)/next.scale).toBeCloseTo((anchor.y-view.height/2-pan.y)/2,10)
 }
})
