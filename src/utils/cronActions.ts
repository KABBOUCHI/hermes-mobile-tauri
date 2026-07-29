export type CronAction = 'pause' | 'resume' | 'trigger'

export function cronActionUrl(baseUrl: string, jobId: string, action: CronAction): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/api/cron/jobs/${encodeURIComponent(jobId)}/${action}`
}
