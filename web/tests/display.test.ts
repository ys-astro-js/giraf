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
