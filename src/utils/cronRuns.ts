export function cronRunsUrl(baseUrl: string, jobId: string, limit = 5): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/api/cron/jobs/${encodeURIComponent(jobId)}/runs?limit=${limit}`
}
