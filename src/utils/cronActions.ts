export type CronAction = 'pause' | 'resume' | 'trigger'

export function cronActionUrl(baseUrl: string, jobId: string, action: CronAction, profile?: string): string {
  const base = baseUrl.replace(/\/$/, '')
  const path = `${base}/api/cron/jobs/${encodeURIComponent(jobId)}/${action}`
  return profile?.trim() ? `${path}?profile=${encodeURIComponent(profile.trim())}` : path
}
