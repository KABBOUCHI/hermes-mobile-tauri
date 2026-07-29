import { describe, expect, it } from 'vitest'
import { extractUnifiedDiff, summarizeToolActivity, thoughtActivityLabel } from './activitySummary'

describe('activity summaries', () => {
  it('collapses a mixed tool run into desktop-style activity clauses', () => {
    expect(summarizeToolActivity([
      { name: 'read_file' },
      { name: 'search_files' },
      { name: 'terminal' },
      { name: 'patch' },
    ])).toBe('Edited file, explored 2 files, ran command')
  })

  it('labels historical reasoning by its measured following interval', () => {
    expect(thoughtActivityLabel(1.7)).toBe('Thought for 2s')
    expect(thoughtActivityLabel(0)).toBe('Thought briefly')
  })

  it('extracts a unified diff while rejecting ordinary tool output', () => {
    expect(extractUnifiedDiff('done')).toBeNull()
    expect(extractUnifiedDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new')).toContain('+new')
  })
})
