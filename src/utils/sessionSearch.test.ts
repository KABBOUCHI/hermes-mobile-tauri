import { describe, expect, it } from 'vitest'
import { sessionMatchesSearch } from './sessionSearch'

const session = {
  id: '20260729_120000_abc123',
  title: 'Prepare mobile release',
  preview: 'Check the Android chat experience',
  model: 'openai/gpt-5.6',
  source: 'whatsapp',
}

describe('sessionMatchesSearch', () => {
  it('matches session identifiers, titles, previews, and models case-insensitively', () => {
    expect(sessionMatchesSearch(session, '120000')).toBe(true)
    expect(sessionMatchesSearch(session, 'MOBILE RELEASE')).toBe(true)
    expect(sessionMatchesSearch(session, 'android')).toBe(true)
    expect(sessionMatchesSearch(session, 'gpt-5.6')).toBe(true)
  })

  it('matches desktop source labels and aliases', () => {
    expect(sessionMatchesSearch(session, 'WhatsApp')).toBe(true)
    expect(sessionMatchesSearch(session, 'wa')).toBe(true)
    expect(sessionMatchesSearch({ ...session, source: 'desktop' }, 'app')).toBe(true)
    expect(sessionMatchesSearch({ ...session, source: 'bluebubbles' }, 'iMessage')).toBe(true)
  })

  it('matches the project context fields exposed by the desktop session sidebar', () => {
    const projectSession = {
      ...session,
      _lineage_root_id: 'lineage-root-123',
      cwd: '/work/hermes-mobile-tauri',
      git_branch: 'feature/session-search',
      git_repo_root: '/work/hermes-mobile-tauri',
    }

    expect(sessionMatchesSearch(projectSession, 'lineage-root-123')).toBe(true)
    expect(sessionMatchesSearch(projectSession, 'hermes-mobile-tauri')).toBe(true)
    expect(sessionMatchesSearch(projectSession, 'feature/session-search')).toBe(true)
  })

  it('does not match unrelated search text', () => {
    expect(sessionMatchesSearch(session, 'totally-unrelated')).toBe(false)
  })
})
