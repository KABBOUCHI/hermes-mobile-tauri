import { describe, expect, it } from 'vitest'
import { normalizeSessionMessages } from './sessionMessages'

describe('normalizeSessionMessages', () => {
  it('retains text, tools, and separate reasoning in server order', () => {
    const messages = normalizeSessionMessages([
      { id: 'u1', role: 'user', content: 'Write a bubble sort', timestamp: 1 },
      {
        id: 'a1',
        role: 'assistant',
        content: 'I will create it.',
        reasoning_content: 'I should provide a complete Rust example.',
        timestamp: 2,
      },
      {
        id: 't1',
        role: 'tool',
        tool_name: 'write_file',
        tool_call_id: 'call-1',
        content: '{"bytes_written":1148}',
        timestamp: 3,
      },
      {
        id: 'a2',
        role: 'assistant',
        content: 'Done.',
        timestamp: 4,
      },
    ])

    expect(messages).toHaveLength(4)
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(messages[1]).toMatchObject({
      content: 'I will create it.',
      reasoning: 'I should provide a complete Rust example.',
    })
    expect(messages[2]).toMatchObject({
      toolName: 'write_file',
      toolCallId: 'call-1',
      content: '{"bytes_written":1148}',
    })
  })

  it('preserves assistant turns that contain reasoning or tool calls but no prose', () => {
    const messages = normalizeSessionMessages([
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        reasoning: 'I should run the validation command.',
        tool_calls: [{ id: 'call-1', function: { name: 'terminal' } }],
        timestamp: 1,
      },
    ])

    expect(messages).toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: '',
        reasoning: 'I should run the validation command.',
        toolCalls: [{ id: 'call-1', name: 'terminal' }],
      }),
    ])
  })

  it('hides expanded attached context from user messages while preserving missing references', () => {
    const messages = normalizeSessionMessages([
      {
        id: 'u1',
        role: 'user',
        content: 'Please review @file:src/App.vue.\n--- Attached Context ---\n@file:src/App.vue\n@folder:src/components\nThe full file contents are attached here.',
        timestamp: 1,
      },
    ])

    expect(messages[0]).toMatchObject({
      role: 'user',
      content: '@folder:src/components\n\nPlease review @file:src/App.vue.',
    })
  })

  it('marks a completed gateway turn as failed while keeping its partial response', async () => {
    const { completionFailure } = await import('./sessionMessages')

    expect(completionFailure({
      status: 'error',
      error: { message: 'Provider rate limit exceeded' },
      partial: true,
    })).toEqual({ message: 'Provider rate limit exceeded', partial: true })
  })

  it('uses failure_reason when a failed completion has no structured error', async () => {
    const { completionFailure } = await import('./sessionMessages')

    expect(completionFailure({ status: 'error', failure_reason: 'billing' }))
      .toEqual({ message: 'billing', partial: false })
  })

  it('confirms truncation when rewinding the first user turn', async () => {
    const { truncateBeforeUserParams } = await import('./sessionMessages')

    expect(truncateBeforeUserParams(0)).toEqual({
      truncate_before_user_ordinal: 0,
      confirm_empty_truncate: true,
    })
    expect(truncateBeforeUserParams(2)).toEqual({
      truncate_before_user_ordinal: 2,
    })
  })
})
