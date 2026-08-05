export const STREAM_STALL_THRESHOLD_MS = 2_000

export type StreamActivityState = 'active' | 'quiet' | 'stalled'

function activityTimestamp(turnStartedAt: number | null, value: number | null): number | null {
  const candidate = value ?? turnStartedAt
  return candidate !== null && Number.isFinite(candidate) ? candidate : null
}

/**
 * Distinguish an agent that is merely quiet from a stream whose transport has
 * also stopped responding. Visible deltas remain the primary activity signal;
 * transport frames only prevent a false "stalled" diagnosis.
 */
export function streamActivityState(
  turnStartedAt: number | null,
  lastVisibleActivityAt: number | null,
  lastTransportActivityAt: number | null,
  now: number,
  thresholdMs: number = STREAM_STALL_THRESHOLD_MS,
): StreamActivityState {
  if (turnStartedAt === null || !Number.isFinite(now) || !Number.isFinite(thresholdMs) || thresholdMs < 0) return 'active'

  const visibleAt = activityTimestamp(turnStartedAt, lastVisibleActivityAt)
  if (visibleAt === null || now - visibleAt < thresholdMs) return 'active'

  const transportAt = activityTimestamp(null, lastTransportActivityAt)
  return transportAt !== null && now - transportAt < thresholdMs ? 'quiet' : 'stalled'
}

/**
 * Return the single next deadline where a stream-status transition can occur.
 * This lets views use a bounded timeout instead of a polling interval.
 */
export function nextStreamActivityDeadline(
  turnStartedAt: number | null,
  lastVisibleActivityAt: number | null,
  lastTransportActivityAt: number | null,
  now: number,
  thresholdMs: number = STREAM_STALL_THRESHOLD_MS,
): number | null {
  if (turnStartedAt === null || !Number.isFinite(now) || !Number.isFinite(thresholdMs) || thresholdMs < 0) return null

  const visibleAt = activityTimestamp(turnStartedAt, lastVisibleActivityAt)
  if (visibleAt === null) return null
  const visibleDeadline = visibleAt + thresholdMs
  if (now < visibleDeadline) return visibleDeadline

  const transportAt = activityTimestamp(null, lastTransportActivityAt)
  if (transportAt === null) return null
  const transportDeadline = transportAt + thresholdMs
  return now < transportDeadline ? transportDeadline : null
}

/** Whether an active turn has lost both visible and transport activity. */
export function isStreamStalled(
  turnStartedAt: number | null,
  lastVisibleActivityAt: number | null,
  now: number,
  thresholdMs: number = STREAM_STALL_THRESHOLD_MS,
  lastTransportActivityAt: number | null = null,
): boolean {
  return streamActivityState(
    turnStartedAt,
    lastVisibleActivityAt,
    lastTransportActivityAt,
    now,
    thresholdMs,
  ) === 'stalled'
}
