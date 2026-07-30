export type MessageLoadErrorState =
  | { kind: 'none'; message: '' }
  | { kind: 'empty' | 'inline'; message: string }

/**
 * A failed refresh must not hide an already readable transcript. Match desktop's
 * recovery contract: use the empty state only when there is nothing to preserve,
 * otherwise leave history in place and expose a compact retry affordance.
 */
export function messageLoadErrorState(error: string, hasMessages: boolean): MessageLoadErrorState {
  const message = error.trim()
  if (!message) return { kind: 'none', message: '' }
  return { kind: hasMessages ? 'inline' : 'empty', message }
}
