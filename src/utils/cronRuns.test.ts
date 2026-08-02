import { describe, expect, it } from 'vitest'
import { cronRunsUrl } from './cronRuns'

describe('cronRunsUrl', () => {
  it('builds the latest-five endpoint with an encoded job id', () => {
    expect(cronRunsUrl('https://hermes.example.com/', 'default:daily report')).toBe(
      'https://hermes.example.com/api/cron/jobs/default%3Adaily%20report/runs?limit=5',
    )
  })

  it('supports a caller-provided run limit', () => {
    expect(cronRunsUrl('https://hermes.example.com', 'job-123', 10)).toBe(
      'https://hermes.example.com/api/cron/jobs/job-123/runs?limit=10',
    )
  })
})
