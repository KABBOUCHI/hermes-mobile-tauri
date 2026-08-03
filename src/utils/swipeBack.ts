export const SWIPE_BACK_EDGE_PX = 28
export const SWIPE_BACK_TRIGGER_PX = 72
export const SWIPE_BACK_HORIZONTAL_RATIO = 1.2

export interface SwipeBackGesture {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

/**
 * Recognise a deliberate left-edge navigation swipe without stealing ordinary
 * vertical transcript scrolling. The gesture must begin near the edge, travel
 * far enough to be intentional, and remain predominantly horizontal.
 */
export function isBackSwipe(gesture: SwipeBackGesture): boolean {
  const distanceX = gesture.currentX - gesture.startX
  const distanceY = Math.abs(gesture.currentY - gesture.startY)

  return gesture.startX <= SWIPE_BACK_EDGE_PX
    && distanceX >= SWIPE_BACK_TRIGGER_PX
    && distanceX >= distanceY * SWIPE_BACK_HORIZONTAL_RATIO
}
