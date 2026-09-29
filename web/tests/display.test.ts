// IRAF display frames open in the standard image viewer as display assets.
import { expect, test } from 'bun:test'
import { displayRow, type DisplayFrame } from '../src/lib/display'

const frame: DisplayFrame = { frame: 2, version: 7, width: 512, height: 512, title: 'm51.fits - m51  B  600s', transform: [1, 0, 0, -1, 1, 512] }

test('a display frame is a viewer image asset addressed by frame number', () => {
  expect(displayRow(frame)).toEqual({ id: 'display:2', label: 'm51.fits - m51  B  600s', asset: 'image' })
})

test('untitled frames are named by number', () => {
  expect(displayRow({ ...frame, title: '' }).label).toBe('프레임 2')
})

import { clampDisplayBox, moveDisplayBox, resizeDisplayBox, readDisplayBox, saveDisplayBox, DISPLAY_MIN_SIZE } from '../src/lib/display'
const area = { width: 800, height: 600 }
const box = { right: 12, bottom: 146, width: 256, height: 256 }

test('moving keeps the window inside the canvas', () => {
  expect(moveDisplayBox(box, -100, -50, area)).toEqual({ ...box, right: 112, bottom: 196 })
  expect(moveDisplayBox(box, 500, 500, area)).toEqual({ ...box, right: 12, bottom: 12 })
  expect(moveDisplayBox(box, -2000, -2000, area)).toEqual({ ...box, right: 800 - 12 - 256, bottom: 600 - 12 - 256 })
})

test('resizing from the bottom-right grip keeps the top-left corner', () => {
  // Against the right edge it can only grow downward; moved left, it grows right too.
  expect(resizeDisplayBox(box, 40, 20, area)).toEqual({ width: 256, height: 276, right: 12, bottom: 126 })
  expect(resizeDisplayBox({ ...box, right: 112 }, 40, 20, area)).toEqual({ width: 296, height: 276, right: 72, bottom: 126 })
  expect(resizeDisplayBox(box, -1000, -1000, area)).toMatchObject(DISPLAY_MIN_SIZE)
})

test('a canvas smaller than the window shrinks it to fit', () => {
  expect(clampDisplayBox(box, { width: 300, height: 250 })).toEqual({ width: 256, height: 226, right: 12, bottom: 12 })
})

test('the saved place survives reloads and ignores broken values', () => {
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
  saveDisplayBox(box, storage)
  expect(readDisplayBox(storage)).toEqual(box)
  store.set('giraf-display-window', '{"right":"x"}')
  expect(readDisplayBox(storage)).toBeUndefined()
})
