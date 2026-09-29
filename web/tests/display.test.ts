// GIRAF display frames: frame-buffer positions map to IRAF image pixels.
import { expect, test } from 'bun:test'
import { displayFrameUrl, displayImagePoint, type DisplayFrame } from '../src/lib/display'

const frame: DisplayFrame = { frame: 1, version: 7, width: 512, height: 512, title: 'm51.fits', transform: [1, 0, 0, -1, 1, 512] }

test('pixel centres follow the IIS transform (image y grows upward)', () => {
  // Top-left frame pixel is image (1, 512); the pixel above the bottom row is y = 2.
  expect(displayImagePoint(frame, 0.5, 0.5)).toEqual({ x: 1, y: 512 })
  expect(displayImagePoint(frame, 99.5, 510.5)).toEqual({ x: 100, y: 2 })
})

test('frames without a transform have no image coordinates', () => {
  expect(displayImagePoint({ ...frame, transform: null }, 1, 1)).toBeNull()
})

test('frame images are cache-busted by version', () => {
  expect(displayFrameUrl(frame)).toBe('/api/display-frame?frame=1&v=7')
})
