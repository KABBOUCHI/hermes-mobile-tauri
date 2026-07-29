export interface ScrollMetrics {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

const FOLLOW_THRESHOLD_PX = 100
const DEFAULT_COMPOSER_HEIGHT_PX = 56
const JUMP_TO_BOTTOM_GAP_PX = 10

/** Whether new messages should keep the conversation pinned to its tail. */
export function isNearChatBottom({ scrollHeight, scrollTop, clientHeight }: ScrollMetrics): boolean {
  return scrollHeight - scrollTop - clientHeight <= FOLLOW_THRESHOLD_PX
}

/** Keeps the floating jump control directly above a measured composer. */
export function jumpToBottomOffset(composerHeight: number): number {
  return Math.max(composerHeight, DEFAULT_COMPOSER_HEIGHT_PX) + JUMP_TO_BOTTOM_GAP_PX
}
