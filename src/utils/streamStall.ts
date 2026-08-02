export const STREAM_STALL_THRESHOLD_MS = 2_000

/** Whether an active turn has gone quiet long enough to show a live status hint. */
export function isStreamStalled(
  turnStartedAt: number | null,
  lastActivityAt: number | null,
  now: number,
  thresholdMs: number = STREAM_STALL_THRESHOLD_MS,
): boolean {
  if (turnStartedAt === null || !Number.isFinite(now)) return false

  const activityAt = lastActivityAt ?? turnStartedAt
  if (!Number.isFinite(activityAt) || !Number.isFinite(thresholdMs) || thresholdMs < 0) return false

  return now - activityAt >= thresholdMs
}
