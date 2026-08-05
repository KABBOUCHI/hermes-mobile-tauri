export interface FileActivityTool {
  id: string
  name: string
  filePaths?: readonly string[]
  failed?: boolean
}

export interface FileActivitySummary {
  paths: string[]
  label: string
}

const PATH_FIELDS: Record<string, readonly string[]> = {
  write_file: ['path'],
  delete_file: ['path'],
  move_file: ['source', 'destination', 'source_path', 'destination_path', 'from', 'to', 'path'],
}

const PATCH_FILE_HEADER = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm
const MAX_PATH_LENGTH = 1024

function safePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path || path.length > MAX_PATH_LENGTH || /[\u0000\r\n]/.test(path)) return null
  return path
}

function recordFromInput(input: unknown): Record<string, unknown> | null {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>
  if (typeof input !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(input)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/**
 * Retain only explicit file identifiers for known mutation tools. Never carry
 * tool content, shell commands, or arbitrary arguments into transcript state.
 */
export function filePathsFromToolInput(name: string, input: unknown): string[] {
  const record = recordFromInput(input)
  if (!record) return []

  const values = name === 'patch'
    ? Array.from(String(record.patch || '').matchAll(PATCH_FILE_HEADER), match => match[1])
    : (PATH_FIELDS[name] || []).map(field => record[field])

  const paths: string[] = []
  for (const value of values) {
    const path = safePath(value)
    if (path && !paths.includes(path)) paths.push(path)
  }
  return paths
}

/** Produce a compact, conservative per-turn list of files targeted by successful mutation tools. */
export function summarizeFileActivity(tools: readonly FileActivityTool[]): FileActivitySummary | null {
  const paths: string[] = []
  for (const tool of tools) {
    if (tool.failed) continue
    for (const path of tool.filePaths || []) {
      const safe = safePath(path)
      if (safe && !paths.includes(safe)) paths.push(safe)
    }
  }
  if (paths.length === 0) return null
  return { paths, label: paths.length === 1 ? '1 file touched' : `${paths.length} files touched` }
}
