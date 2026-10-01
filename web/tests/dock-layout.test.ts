// Snapped windows tile like desktop systems: sides keep their pixel sizes,
// the center takes the rest, and a preview asks for the same boxes.
import { expect, test } from 'bun:test'
import { emptySnaps, regionBoxes, resized, setHidden, snap, snapBoxes, unsnap } from '../src/features/dock/layout'

const workbench = { width: 1440, height: 844 }

test('snapping to the right keeps the window snapped on the left at its size', () => {
  let snaps = snap(emptySnaps(), 'files', 'left')
  snaps = snap(snaps, 'inspector', 'right')
  const boxes = snapBoxes(snaps, workbench)
  expect(boxes.get('files')).toEqual({ left: 0, top: 0, width: 256, height: 844 })
  expect(boxes.get('inspector')).toEqual({ left: 1056, top: 0, width: 384, height: 844 })
})

test('the top edge fills all the space the sides leave', () => {
  let snaps = snap(emptySnaps(), 'files', 'left')
  snaps = snap(snaps, 'inspector', 'right')
  snaps = snap(snaps, 'history', 'bottom')
  snaps = snap(snaps, 'workflow', 'center')
  expect(snapBoxes(snaps, workbench).get('workflow')).toEqual({ left: 256, top: 0, width: 800, height: 604 })
})

test('a window leaving takes nothing from the others', () => {
  let snaps = snap(emptySnaps(), 'files', 'left')
  snaps = snap(snaps, 'inspector', 'right')
  snaps = snap(snaps, 'workflow', 'center')
  const before = snapBoxes(snaps, workbench)
  snaps = unsnap(snaps, 'files')
  const after = snapBoxes(snaps, workbench)
  expect(after.get('inspector')).toEqual(before.get('inspector')!)
  expect(after.has('files')).toBe(false)
})

test('hiding a side gives its space to the windows beside it, and showing it returns it', () => {
  let snaps = snap(emptySnaps(), 'files', 'left')
  snaps = snap(snaps, 'workflow', 'center')
  snaps = snap(snaps, 'inspector', 'right')
  snaps = setHidden(snaps, 'left', true)
  expect(snapBoxes(snaps, workbench).get('workflow')).toEqual({ left: 0, top: 0, width: 1056, height: 844 })
  expect(snapBoxes(snaps, workbench).has('files')).toBe(false)
  snaps = setHidden(snaps, 'left', false)
  expect(snapBoxes(snaps, workbench).get('workflow')).toEqual({ left: 256, top: 0, width: 800, height: 844 })
})

test('the workbench resizing changes only the center', () => {
  let snaps = snap(emptySnaps(), 'files', 'left')
  snaps = snap(snaps, 'workflow', 'center')
  snaps = snap(snaps, 'inspector', 'right')
  const small = snapBoxes(snaps, { width: 1000, height: 700 })
  expect(small.get('files')!.width).toBe(256)
  expect(small.get('inspector')!.width).toBe(384)
  expect(small.get('workflow')!.width).toBe(360)
})

test('a window placed beside another takes half of its share', () => {
  let snaps = snap(emptySnaps(), 'files', 'left')
  snaps = snap(snaps, 'runs', 'left', { id: 'files', side: 'bottom' })
  const boxes = snapBoxes(snaps, workbench)
  expect(boxes.get('files')).toEqual({ left: 0, top: 0, width: 256, height: 422 })
  expect(boxes.get('runs')).toEqual({ left: 0, top: 422, width: 256, height: 422 })
})

test('splitting the center sets its axis by the side', () => {
  let snaps = snap(emptySnaps(), 'workflow', 'center')
  snaps = snap(snaps, 'viewer', 'center', { id: 'workflow', side: 'top' })
  const boxes = snapBoxes(snaps, workbench)
  expect(boxes.get('viewer')).toEqual({ left: 0, top: 0, width: 1440, height: 422 })
  expect(boxes.get('workflow')).toEqual({ left: 0, top: 422, width: 1440, height: 422 })
})

test('resizing a side window by its inner edge sets the side size', () => {
  let snaps = snap(emptySnaps(), 'files', 'left')
  snaps = snap(snaps, 'workflow', 'center')
  snaps = resized(snaps, 'files', { left: 0, top: 0, width: 320, height: 844 }, workbench)
  expect(snapBoxes(snaps, workbench).get('workflow')).toEqual({ left: 320, top: 0, width: 1120, height: 844 })
})

test('an empty side takes no room', () => {
  const snaps = snap(emptySnaps(), 'workflow', 'center')
  expect(regionBoxes(snaps, workbench).center).toEqual({ left: 0, top: 0, width: 1440, height: 844 })
})

test('a side whose windows left stays desktop: snapping elsewhere does not grow the center into it', () => {
  let snaps = snap(emptySnaps(), 'files', 'left')
  snaps = snap(snaps, 'workflow', 'center')
  snaps = snap(snaps, 'inspector', 'right')
  snaps = unsnap(snaps, 'files')
  snaps = snap(snaps, 'runs', 'right', { id: 'inspector', side: 'bottom' })
  expect(snapBoxes(snaps, workbench).get('workflow')).toEqual({ left: 256, top: 0, width: 800, height: 844 })
})

test('a window snapping to a side left empty takes its kept space', () => {
  let snaps = snap(emptySnaps(), 'files', 'left')
  snaps = snap(snaps, 'workflow', 'center')
  snaps = unsnap(snaps, 'files')
  snaps = snap(snaps, 'runs', 'left')
  expect(snapBoxes(snaps, workbench).get('runs')).toEqual({ left: 0, top: 0, width: 256, height: 844 })
  expect(snapBoxes(snaps, workbench).get('workflow')).toEqual({ left: 256, top: 0, width: 1184, height: 844 })
})

test('filling the center takes every space the sides left', () => {
  let snaps = snap(emptySnaps(), 'files', 'left')
  snaps = snap(snaps, 'workflow', 'center')
  snaps = unsnap(snaps, 'files')
  snaps = unsnap(snaps, 'workflow')
  snaps = snap(snaps, 'viewer', 'center')
  expect(snapBoxes(snaps, workbench).get('viewer')).toEqual({ left: 0, top: 0, width: 1440, height: 844 })
})
