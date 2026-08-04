export interface ImageTransform {
  scale: number
  x: number
  y: number
}

export const IMAGE_MIN_SCALE = 0.25
export const IMAGE_MAX_SCALE = 8

function clampScale(scale: number): number {
  return Math.min(IMAGE_MAX_SCALE, Math.max(IMAGE_MIN_SCALE, scale))
}

export function resetImageTransform(): ImageTransform {
  return { scale: 1, x: 0, y: 0 }
}

/** Zoom around a point measured from the preview surface centre. */
export function imageZoom(
  transform: ImageTransform,
  factor: number,
  originX = 0,
  originY = 0,
): ImageTransform {
  const scale = clampScale(transform.scale * factor)
  const ratio = scale / transform.scale

  return {
    scale,
    x: originX - ratio * (originX - transform.x),
    y: originY - ratio * (originY - transform.y),
  }
}

export function imagePan(transform: ImageTransform, deltaX: number, deltaY: number): ImageTransform {
  return {
    ...transform,
    x: transform.x + deltaX,
    y: transform.y + deltaY,
  }
}
