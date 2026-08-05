export interface CronDraft {
  name: string
  prompt: string
  schedule: string
  deliver: string
  script: string
  noAgent: boolean
}

export interface CronPayload {
  name?: string
  prompt?: string
  schedule: string
  deliver?: string
  script?: string
  no_agent?: boolean
}

export function validateCronDraft(draft: CronDraft): string | null {
  const prompt = draft.prompt.trim()
  const schedule = draft.schedule.trim()
  const script = draft.script.trim()
  if (!draft.noAgent && !prompt && !schedule) return 'Enter a prompt and schedule'
  if (!schedule) return 'Enter a schedule'
  if (draft.noAgent && !script) return 'Enter a script path'
  if (!draft.noAgent && !prompt) return 'Enter a prompt'
  return null
}

export function cronPayload(draft: CronDraft): CronPayload {
  const name = draft.name.trim()
  const deliver = draft.deliver.trim()
  const script = draft.script.trim()
  return {
    ...(name ? { name } : {}),
    ...(!draft.noAgent ? { prompt: draft.prompt.trim() } : {}),
    schedule: draft.schedule.trim(),
    ...(deliver ? { deliver } : {}),
    ...(script ? { script } : {}),
    ...(draft.noAgent ? { no_agent: true } : {}),
  }
}

export function cronProfileForJob(job: { profile?: unknown }, fallbackProfile: string): string {
  return typeof job.profile === 'string' && job.profile.trim() ? job.profile.trim() : fallbackProfile
}

export function cronJobUrl(baseUrl: string, jobId?: string, profile?: string): string {
  const base = baseUrl.replace(/\/$/, '')
  const path = jobId ? `${base}/api/cron/jobs/${encodeURIComponent(jobId)}` : `${base}/api/cron/jobs`
  return profile?.trim() ? `${path}?profile=${encodeURIComponent(profile.trim())}` : path
}
