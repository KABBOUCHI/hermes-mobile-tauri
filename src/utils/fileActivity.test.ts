import { describe, expect, it } from 'vitest'
import { filePathsFromToolInput, summarizeFileActivity } from './fileActivity'

describe('file activity summaries', () => {
  it('extracts only explicit paths from known file mutation tools', () => {
    expect(filePathsFromToolInput('write_file', { path: 'src/App.vue', content: 'secret source stays out' }))
      .toEqual(['src/App.vue'])
    expect(filePathsFromToolInput('move_file', { source: 'src/old.ts', destination: 'src/new.ts' }))
      .toEqual(['src/old.ts', 'src/new.ts'])
    expect(filePathsFromToolInput('terminal', { command: 'rm -rf /' })).toEqual([])
  })

  it('reads standard V4A patch file headers without exposing patch content', () => {
    expect(filePathsFromToolInput('patch', {
      patch: '*** Begin Patch\n*** Update File: src/App.vue\n*** Add File: src/new.ts\n*** End Patch',
    })).toEqual(['src/App.vue', 'src/new.ts'])
  })

  it('deduplicates successful file targets in source order and ignores failed tools', () => {
    expect(summarizeFileActivity([
      { id: '1', name: 'write_file', filePaths: ['src/App.vue'] },
      { id: '2', name: 'patch', filePaths: ['src/App.vue', 'src/router.ts'] },
      { id: '3', name: 'delete_file', filePaths: ['src/stale.ts'], failed: true },
    ])).toEqual({ paths: ['src/App.vue', 'src/router.ts'], label: '2 files touched' })
  })

  it('does not produce a file summary when no safe path is available', () => {
    expect(summarizeFileActivity([{ id: '1', name: 'terminal' }])).toBeNull()
  })
})
