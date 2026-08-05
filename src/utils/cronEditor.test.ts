import { describe, expect, it } from 'vitest'
import { cronJobUrl, cronPayload, cronProfileForJob, validateCronDraft } from './cronEditor'

describe('cron editor helpers', () => {
  it('requires a prompt and a schedule for agent jobs', () => {
    expect(validateCronDraft({ name: '', prompt: ' ', schedule: ' ', deliver: 'local', script: '', noAgent: false })).toBe('Enter a prompt and schedule')
    expect(validateCronDraft({ name: '', prompt: 'Run the report', schedule: ' ', deliver: 'local', script: '', noAgent: false })).toBe('Enter a schedule')
    expect(validateCronDraft({ name: '', prompt: ' ', schedule: '0 9 * * *', deliver: 'local', script: '', noAgent: false })).toBe('Enter a prompt')
  })

  it('requires a script for script-only jobs while allowing an empty agent prompt', () => {
    expect(validateCronDraft({ name: '', prompt: '', schedule: 'every 1h', deliver: 'local', script: '', noAgent: true })).toBe('Enter a script path')
    expect(validateCronDraft({ name: '', prompt: '', schedule: 'every 1h', deliver: 'local', script: 'report.sh', noAgent: true })).toBeNull()
  })

  it('builds a compact create or update payload without empty optional fields', () => {
    const draft = { name: ' Daily report ', prompt: ' Summarize yesterday ', schedule: ' 0 9 * * * ', deliver: ' local ', script: '', noAgent: false }
    expect(cronPayload(draft)).toEqual({ name: 'Daily report', prompt: 'Summarize yesterday', schedule: '0 9 * * *', deliver: 'local' })
    expect(cronPayload({ ...draft, name: '', deliver: '' })).toEqual({ prompt: 'Summarize yesterday', schedule: '0 9 * * *' })
    expect(cronPayload({ ...draft, prompt: '', script: ' hourly-report.sh ', noAgent: true })).toEqual({
      name: 'Daily report',
      schedule: '0 9 * * *',
      deliver: 'local',
      script: 'hourly-report.sh',
      no_agent: true,
    })
  })

  it('uses encoded create and update endpoints', () => {
    expect(cronJobUrl('https://hermes.example.com/', 'default:daily report')).toBe('https://hermes.example.com/api/cron/jobs/default%3Adaily%20report')
    expect(cronJobUrl('https://hermes.example.com')).toBe('https://hermes.example.com/api/cron/jobs')
  })

  it('selects a concrete profile for cross-profile mutation requests', () => {
    expect(cronJobUrl('https://hermes.example.com/', 'default:daily report', 'work profile')).toBe(
      'https://hermes.example.com/api/cron/jobs/default%3Adaily%20report?profile=work%20profile',
    )
    expect(cronProfileForJob({ profile: 'personal' }, 'default')).toBe('personal')
    expect(cronProfileForJob({}, 'default')).toBe('default')
  })
})
