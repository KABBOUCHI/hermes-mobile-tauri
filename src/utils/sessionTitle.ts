export interface SessionTitleFields {
  title?: string | null
  preview?: string | null
}

/**
 * Keep the list title distinct from the last-message preview. Desktop uses the
 * preview as a fallback title because it has no second preview row; mobile does,
 * so showing it twice makes untitled sessions look duplicated.
 */
export function sessionListTitle(session: SessionTitleFields): string {
  return session.title?.trim() || 'Untitled session'
}

export function sessionPreview(session: SessionTitleFields): string {
  return session.preview?.trim() || 'No messages'
}
