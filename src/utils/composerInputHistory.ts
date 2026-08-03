export interface ComposerBrowseState {
  cursor: number
  draftSnapshot: string
}

const browseStates = new Map<string, ComposerBrowseState>()

function stateFor(sessionId: string): ComposerBrowseState {
  const existing = browseStates.get(sessionId)
  if (existing) return existing

  const state = { cursor: -1, draftSnapshot: '' }
  browseStates.set(sessionId, state)
  return state
}

function validSessionId(sessionId: string | null | undefined): sessionId is string {
  return typeof sessionId === 'string' && sessionId.trim().length > 0
}

/** Derive the sent user-message ring in newest-first order. */
export function deriveUserHistory<T extends { role: string }>(
  messages: readonly T[],
  getText: (message: T) => string,
): string[] {
  const history: string[] = []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue

    const text = getText(message).trim()
    if (text) history.push(text)
  }

  return history
}

/** Begin or continue browsing older sent prompts for one session. */
export function browseBackward(
  sessionId: string | null | undefined,
  currentDraft: string,
  history: readonly string[],
): string | null {
  if (!validSessionId(sessionId) || history.length === 0) return null

  const state = stateFor(sessionId)
  if (state.cursor === -1) {
    state.draftSnapshot = currentDraft
    state.cursor = 0
  } else if (state.cursor < history.length - 1) {
    state.cursor += 1
  } else {
    return null
  }

  return history[state.cursor] ?? null
}

/** Walk toward the present, restoring the draft after the newest prompt. */
export function browseForward(
  sessionId: string | null | undefined,
  history: readonly string[],
): { text: string; returnedToPresent: boolean } | null {
  if (!validSessionId(sessionId)) return null

  const state = stateFor(sessionId)
  if (state.cursor === -1) return null

  if (state.cursor > 0) {
    state.cursor -= 1
    return {
      text: history[state.cursor] ?? '',
      returnedToPresent: false,
    }
  }

  const text = state.draftSnapshot
  state.cursor = -1
  state.draftSnapshot = ''
  return { text, returnedToPresent: true }
}

/** Stop browsing without discarding the session's sent-message history. */
export function resetComposerBrowse(sessionId: string | null | undefined): void {
  if (!validSessionId(sessionId)) return
  browseStates.set(sessionId, { cursor: -1, draftSnapshot: '' })
}

export function isBrowsingComposerHistory(sessionId: string | null | undefined): boolean {
  if (!validSessionId(sessionId)) return false
  return (browseStates.get(sessionId)?.cursor ?? -1) >= 0
}

/** Test and lifecycle helper; production callers normally reset one session. */
export function clearComposerBrowseState(): void {
  browseStates.clear()
}
