import { describe, expect, it } from 'vitest'
import { cronActionUrl } from './cronActions'

describe('cronActionUrl', () => {
  it('builds encoded lifecycle endpoints from a gateway URL without a trailing slash', () => {
    expect(cronActionUrl('https://hermes.example.com/', 'default:daily report', 'pause')).toBe(
      'https://hermes.example.com/api/cron/jobs/default%3Adaily%20report/pause',
    )
    expect(cronActionUrl('https://hermes.example.com', 'job-123', 'resume')).toBe(
      'https://hermes.example.com/api/cron/jobs/job-123/resume',
    )
    expect(cronActionUrl('https://hermes.example.com', 'job-123', 'trigger')).toBe(
      'https://hermes.example.com/api/cron/jobs/job-123/trigger',
    )
    expect(cronActionUrl('https://hermes.example.com', 'default:daily report', 'pause', 'work profile')).toBe(
      'https://hermes.example.com/api/cron/jobs/default%3Adaily%20report/pause?profile=work%20profile',
    )
  })
})
