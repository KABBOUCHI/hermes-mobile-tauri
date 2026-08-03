import { describe, expect, it } from 'vitest'
import {
  normalizeProjectTreePayload,
  normalizeProjectsPayload,
  projectCreateParams,
  projectPrimaryPath,
  projectSessionCreateParams,
} from './projects'

describe('project gateway payloads', () => {
  it('keeps valid projects and the server-selected active project', () => {
    const first = {
      id: 'p_first',
      slug: 'first',
      name: 'First project',
      primary_path: '/workspace/first',
      folders: [],
    }
    const second = {
      id: 'p_second',
      slug: 'second',
      name: 'Second project',
      primary_path: null,
      folders: [{ path: '/workspace/second', label: null, is_primary: true, added_at: 1 }],
    }

    expect(normalizeProjectsPayload({ projects: [first, second], active_id: 'p_second' })).toEqual({
      projects: [first, second],
      activeId: 'p_second',
    })
  })

  it('drops malformed rows and clears a stale active id', () => {
    const project = { id: 'p_valid', slug: 'valid', name: 'Valid', primary_path: null, folders: [] }

    expect(normalizeProjectsPayload({ projects: [project, { id: '', name: 'Broken' }], active_id: 'p_missing' })).toEqual({
      projects: [project],
      activeId: null,
    })
  })

  it('keeps a discovered workspace from the Desktop project tree', () => {
    expect(normalizeProjectTreePayload({
      active_id: null,
      projects: [{
        id: '/workspace/hermes-mobile-tauri',
        label: 'hermes-mobile-tauri',
        path: '/workspace/hermes-mobile-tauri',
        isAuto: true,
        repos: [],
        sessionCount: 2,
      }],
    })).toEqual({
      activeId: null,
      projects: [{
        id: '/workspace/hermes-mobile-tauri',
        slug: '/workspace/hermes-mobile-tauri',
        name: 'hermes-mobile-tauri',
        primary_path: '/workspace/hermes-mobile-tauri',
        folders: [{ path: '/workspace/hermes-mobile-tauri', label: null, is_primary: true, added_at: 0 }],
        is_auto: true,
        session_count: 2,
      }],
    })
  })
})

describe('project workspace helpers', () => {
  it('uses the persisted primary path before a primary folder fallback', () => {
    expect(projectPrimaryPath({
      id: 'p_one', slug: 'one', name: 'One', primary_path: '/repo/one',
      folders: [{ path: '/repo/fallback', label: null, is_primary: true, added_at: 1 }],
    })).toBe('/repo/one')

    expect(projectPrimaryPath({
      id: 'p_two', slug: 'two', name: 'Two', primary_path: null,
      folders: [{ path: '/repo/two', label: null, is_primary: true, added_at: 1 }],
    })).toBe('/repo/two')
  })

  it('builds the smallest create payload and does not send a blank folder', () => {
    expect(projectCreateParams('  Hermes Mobile  ', ' /home/hermes/hermes-mobile-tauri ')).toEqual({
      name: 'Hermes Mobile',
      folders: ['/home/hermes/hermes-mobile-tauri'],
      primary_path: '/home/hermes/hermes-mobile-tauri',
      use: true,
    })
    expect(projectCreateParams('Scratch', '  ')).toEqual({
      name: 'Scratch',
      folders: [],
      use: true,
    })
  })

  it('anchors a new mobile chat to the selected project directory', () => {
    expect(projectSessionCreateParams('/workspace/hermes-mobile-tauri')).toEqual({
      cols: 96,
      source: 'desktop',
      cwd: '/workspace/hermes-mobile-tauri',
    })
    expect(projectSessionCreateParams('  ')).toEqual({ cols: 96, source: 'desktop' })
  })
})
