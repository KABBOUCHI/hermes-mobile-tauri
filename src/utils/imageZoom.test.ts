import { describe, expect, it } from 'vitest'
import { imagePan, imageZoom, resetImageTransform, type ImageTransform } from './imageZoom'

describe('image zoom transforms', () => {
  it('starts from a neutral transform', () => {
    expect(resetImageTransform()).toEqual({ scale: 1, x: 0, y: 0 })
  })

  it('zooms toward the requested point while preserving that point', () => {
    const transform: ImageTransform = { scale: 1, x: 0, y: 0 }

    expect(imageZoom(transform, 2, 100, -50)).toEqual({
      scale: 2,
      x: -100,
      y: 50,
    })
  })

  it('clamps zoom and applies drag deltas immutably', () => {
    const transform: ImageTransform = { scale: 1, x: 12, y: -8 }

    expect(imageZoom(transform, 100)).toEqual({ scale: 8, x: 96, y: -64 })
    expect(imageZoom(transform, 0.001)).toEqual({ scale: 0.25, x: 3, y: -2 })
    expect(imagePan(transform, 18, 24)).toEqual({ scale: 1, x: 30, y: 16 })
    expect(transform).toEqual({ scale: 1, x: 12, y: -8 })
  })
})
