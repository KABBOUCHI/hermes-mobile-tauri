export interface ProjectFolder {
  path: string
  label: string | null
  is_primary: boolean
  added_at: number
}

export interface Project {
  id: string
  slug: string
  name: string
  description?: string | null
  icon?: string | null
  color?: string | null
  board_slug?: string | null
  primary_path: string | null
  archived?: boolean
  created_at?: number
  folders: ProjectFolder[]
}

export interface ProjectsPayload {
  projects: Project[]
  activeId: string | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeFolder(value: unknown): ProjectFolder | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const path = text(record.path)
  if (!path) return null

  return {
    path,
    label: typeof record.label === 'string' ? record.label : null,
    is_primary: record.is_primary === true,
    added_at: typeof record.added_at === 'number' ? record.added_at : 0,
  }
}

function normalizeProject(value: unknown): Project | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = text(record.id)
  const slug = text(record.slug)
  const name = text(record.name)
  if (!id || !slug || !name) return null

  const folders = Array.isArray(record.folders)
    ? record.folders.map(normalizeFolder).filter((folder): folder is ProjectFolder => folder !== null)
    : []

  return {
    ...record,
    id,
    slug,
    name,
    primary_path: text(record.primary_path) || null,
    folders,
  } as Project
}

/** Normalise the projects RPC without trusting stale or malformed remote rows. */
export function normalizeProjectsPayload(value: unknown): ProjectsPayload {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const projects = Array.isArray(record.projects)
    ? record.projects.map(normalizeProject).filter((project): project is Project => project !== null)
    : []
  const requestedActiveId = text(record.active_id)
  const activeId = projects.some(project => project.id === requestedActiveId) ? requestedActiveId : null

  return { projects, activeId }
}

/** Resolve the directory for a new chat from the same persisted data Desktop uses. */
export function projectPrimaryPath(project: Project): string {
  const explicit = text(project.primary_path)
  if (explicit) return explicit
  return project.folders.find(folder => folder.is_primary)?.path || project.folders[0]?.path || ''
}

/** Build a conservative projects.create request: paths are optional, never blank. */
export function projectCreateParams(name: string, primaryPath: string): Record<string, unknown> {
  const trimmedName = name.trim()
  const path = primaryPath.trim()
  return {
    name: trimmedName,
    ...(path ? { folders: [path], primary_path: path } : { folders: [] }),
    use: true,
  }
}

/** Session-create parameters that preserve the selected project's workspace. */
export function projectSessionCreateParams(cwd: string): Record<string, unknown> {
  const workspaceCwd = cwd.trim()
  return {
    cols: 96,
    source: 'desktop',
    ...(workspaceCwd ? { cwd: workspaceCwd } : {}),
  }
}
