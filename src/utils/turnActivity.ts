export interface SettledTurnActivity {
  turnStartedAt: null
  lastStreamActivityAt: null
}

/** The activity clocks must both stop when a turn reaches any terminal state. */
export function settledTurnActivity(): SettledTurnActivity {
  return {
    turnStartedAt: null,
    lastStreamActivityAt: null,
  }
}
