import { expect, test } from "bun:test"
import { parseTvmark, tvmarkSource, tvmarkStyle, tvmarkPreview } from "../src/lib/tvmark"
import { drawTvmark } from "../src/features/viewer/tvmark-rendering"
import type { Job, Manifest } from "../src/lib/workbench"

test("tvmark reads daofind and plain coordinate files in native one-based coordinates", () => {
  const text = "#K IMAGE = star.fits\n#N XCENTER YCENTER MAG SHARPNESS SROUND GROUND ID\n12.25 30.75 -5.3 0.8 0.1 0.2 1\n1D+2 200 label\n"
  expect(parseTvmark(text, { number: "yes" }).map(m => [m.x, m.y, m.label])).toEqual([[12.25,30.75,"1"],[100,200,"2"]])
  expect(parseTvmark(text, { label: "yes", number: "yes" })[0].label).toBe("-5.3")
  expect(parseTvmark("# empty\n", {})).toEqual([])
  expect(parseTvmark("1 2\n", {})[0].label).toBe("")
  expect(() => parseTvmark("NaN 2\n", {})).toThrow()
  expect(() => parseTvmark("1 INDEF\n", {})).toThrow()
})

test("source selection follows the exact product provenance, not the first image", () => {
  const rows = [{id:"a",label:"a.fits",asset:"image"},{id:"b",label:"b.fits",asset:"image"}]
  const job = {task:"noao.digiphot.apphot.daofind",products:[{id:"c",label:"b.coo",source:"b"}],manifest:{inputs:{image:["a","b"]},rows}} as Job
  expect(tvmarkSource("c",job)?.id).toBe("b")
  expect(tvmarkSource("unknown",job)).toBeUndefined()
  expect(tvmarkSource("c",{...job,products:[{id:"c",label:"c.coo"}]})).toBeUndefined()
  expect(() => tvmarkSource("c", {...job,manifest:{...job.manifest!,parameters:{wcsout:"world"}}})).toThrow()
})

test("preview rejects cursor editing and output requests instead of silently dropping them", () => {
  const m = {task:"images.tv.tvmark",inputs:{coords:["c"]},parameters:{},outputs:{},rows:[{id:"c",label:"c.coo",asset:"text"}]} as unknown as Manifest
  expect(tvmarkPreview(m)?.id).toBe("c")
  expect(tvmarkPreview({...m,task:"other"})).toBeNull()
  expect(() => tvmarkPreview({...m,cursorCommands:{commands:"1 2 1 a"}})).toThrow()
  expect(() => tvmarkPreview({...m,outputs:{outimage:"snap.fits"}})).toThrow()
  expect(() => tvmarkPreview({...m,inputs:{...m.inputs,commands:["cmd"]}})).toThrow()
  expect(() => tvmarkPreview({...m,inputs:{...m.inputs,font:["custom"]}})).toThrow()
})

test("native mark settings retain image radii, labels, color and display offsets", () => {
  const style = tvmarkStyle({mark:"circle",color:204,nxoffset:2,nyoffset:3}, "5,10")
  expect(style.shape).toBe("circle")
  expect(style.sizes).toEqual([5,10])
  expect(tvmarkStyle({mark:"circle"},"5\n10\n").sizes).toEqual([5,10])
  expect(style.color).toBe("red")
  expect(tvmarkStyle({mark:"rectangle"},"", "10,20 0.5").ratio).toBe(.5)
  expect(tvmarkStyle({pointsize:4}).pointSize).toBe(5)
  expect(() => tvmarkStyle({mark:"circle"},"bad")).toThrow()
})

test("overlay uses FITS bottom-left coordinates and scales image radii with zoom", () => {
  const arcs: number[][] = [], labels: unknown[][] = []
  const ctx = {save(){},restore(){},beginPath(){},stroke(){},arc(...v:number[]){arcs.push(v)},fillText(...v:unknown[]){labels.push(v)}} as unknown as CanvasRenderingContext2D
  const style = tvmarkStyle({mark:"circle",nxoffset:2,nyoffset:3},"5")
  drawTvmark(ctx, {x:1,y:1,label:"1",appearance:style}, undefined, {x:10,y:20,w:200,h:200}, {width:100,height:100})
  expect(arcs[0].slice(0,3)).toEqual([11,219,10])
  expect(labels[0]).toEqual(["1",13,216])
})
