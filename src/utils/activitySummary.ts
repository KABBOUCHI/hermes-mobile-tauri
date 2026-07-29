export interface ActivityTool {
  name: string
}

type ActivityCategory = 'edit' | 'explore' | 'run' | 'other'

const EXPLORE_TOOLS = new Set([
  'list_files',
  'read_file',
  'search_files',
  'session_search',
  'vision_analyze',
  'web_extract',
  'web_search',
])

const EDIT_TOOLS = new Set(['patch', 'write_file', 'delete_file', 'move_file'])

function categoryForTool(name: string): ActivityCategory {
  if (EDIT_TOOLS.has(name)) return 'edit'
  if (name === 'terminal' || name === 'execute_code' || name === 'process') return 'run'
  if (EXPLORE_TOOLS.has(name) || name.startsWith('browser_')) return 'explore'
  return 'other'
}

function clause(category: ActivityCategory, count: number): string {
  if (category === 'edit') return count === 1 ? 'Edited file' : `Edited ${count} files`
  if (category === 'explore') return count === 1 ? 'Explored file' : `Explored ${count} files`
  if (category === 'run') return count === 1 ? 'Ran command' : `Ran ${count} commands`
  return count === 1 ? 'Used tool' : `Used ${count} tools`
}

/** Compact historical equivalent of desktop's tool-run scaffold label. */
export function summarizeToolActivity(tools: readonly ActivityTool[]): string {
  if (tools.length === 0) return 'Activity completed'

  const counts = new Map<ActivityCategory, number>()
  for (const tool of tools) {
    const category = categoryForTool(tool.name)
    counts.set(category, (counts.get(category) || 0) + 1)
  }

  return (['edit', 'explore', 'run', 'other'] as const)
    .flatMap(category => {
      const count = counts.get(category)
      return count ? [clause(category, count)] : []
    })
    .map((text, index) => index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1))
    .join(', ')
}

/** Historical records have no explicit thought duration; use the next event delta when available. */
export function thoughtActivityLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return 'Thought briefly'
  return `Thought for ${Math.round(seconds)}s`
}

/** Extract only reviewable unified diffs; ordinary tool output must remain ordinary output. */
export function extractUnifiedDiff(content: string): string | null {
  const gitStart = content.indexOf('diff --git ')
  if (gitStart >= 0) return content.slice(gitStart).trim()

  const fileStart = content.search(/^---\s+[^\n]+\n\+\+\+\s+[^\n]+/m)
  if (fileStart >= 0) return content.slice(fileStart).trim()

  return null
}
