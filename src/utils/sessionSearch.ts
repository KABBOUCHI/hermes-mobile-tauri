export interface SearchableSession {
  id: string
  _lineage_root_id?: string | null
  cwd?: string | null
  git_branch?: string | null
  git_repo_root?: string | null
  title?: string | null
  preview?: string | null
  model?: string | null
  source?: string | null
}

const SOURCE_LABELS: Record<string, string> = {
  api_server: 'API',
  bluebubbles: 'iMessage',
  cli: 'CLI',
  codex: 'Codex',
  desktop: 'Desktop',
  discord: 'Discord',
  email: 'Email',
  gateway: 'Gateway',
  local: 'Local',
  matrix: 'Matrix',
  mattermost: 'Mattermost',
  qqbot: 'QQ',
  signal: 'Signal',
  slack: 'Slack',
  sms: 'SMS',
  telegram: 'Telegram',
  tui: 'TUI',
  webhook: 'Webhook',
  weixin: 'WeChat',
  whatsapp: 'WhatsApp',
  yuanbao: 'Yuanbao',
}

// Kept aligned with desktop's session-source.ts so mobile search recognises
// the platform names people actually use, not only gateway source IDs.
const SOURCE_ALIASES: Record<string, string[]> = {
  bluebubbles: ['apple messages', 'imessage'],
  cli: ['terminal'],
  desktop: ['app', 'gui'],
  local: ['machine'],
  qqbot: ['qq'],
  telegram: ['tg'],
  tui: ['terminal'],
  weixin: ['wechat'],
  whatsapp: ['wa'],
}

/** Ignore a finished search when a newer query has already taken ownership. */
export function isCurrentSessionSearchGeneration(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration
}

function sourceSearchTerms(source: string | null | undefined): string[] {
  const id = source?.trim().toLowerCase() || ''
  if (!id) return []

  const label = SOURCE_LABELS[id] || id.replace(/[_-]+/g, ' ')
  return [id, label, ...(SOURCE_ALIASES[id] || [])]
}

export function sessionMatchesSearch(session: SearchableSession, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  return [
    session.id,
    session._lineage_root_id || '',
    session.title || '',
    session.preview || '',
    session.model || '',
    session.cwd || '',
    session.git_branch || '',
    session.git_repo_root || '',
    ...sourceSearchTerms(session.source),
  ].some(value => value.toLowerCase().includes(needle))
}
