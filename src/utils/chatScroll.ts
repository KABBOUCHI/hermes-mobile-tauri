export interface ScrollMetrics {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

const FOLLOW_THRESHOLD_PX = 100

/** Whether new messages should keep the conversation pinned to its tail. */
export function isNearChatBottom({ scrollHeight, scrollTop, clientHeight }: ScrollMetrics): boolean {
  return scrollHeight - scrollTop - clientHeight <= FOLLOW_THRESHOLD_PX
}
