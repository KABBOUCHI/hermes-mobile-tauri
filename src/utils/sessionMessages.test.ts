import { describe, expect, it } from 'vitest'
import { applyEditedUserTurn, branchableMessageHistory, branchableMessageHistoryThrough, finalizeInterruptedMessages, markLatestAssistantFailure, normalizeSessionMessages, processNotification, rewindToMessage, userOrdinalAtMessageIndex } from './sessionMessages'

describe('processNotification', () => {
  it('parses desktop background notices into a compact headline and output', () => {
    expect(processNotification('[IMPORTANT: Background process 123 finished\ncommand output\nline two]')).toEqual({
      headline: 'Background process 123 finished',
      detail: 'command output\nline two',
    })
  })

  it('rejects ordinary user messages and malformed notices', () => {
    expect(processNotification('Background process 123 finished')).toBeNull()
    expect(processNotification('[IMPORTANT: Something else]')).toBeNull()
  })
})

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

  it('groups adjacent tool results into one compact transcript record', () => {
    const messages = normalizeSessionMessages([
      { id: 't1', role: 'tool', tool_name: 'search_files', content: 'first', timestamp: 1 },
      { id: 't2', role: 'tool', tool_name: 'read_file', content: 'second', timestamp: 2 },
      { id: 't3', role: 'tool', tool_name: 'terminal', content: 'third', timestamp: 3 },
      { id: 'a1', role: 'assistant', content: 'Finished.', timestamp: 4 },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      role: 'tool',
      toolResults: [
        { id: 't1', name: 'search_files', content: 'first' },
        { id: 't2', name: 'read_file', content: 'second' },
        { id: 't3', name: 'terminal', content: 'third' },
      ],
    })
  })

  it('groups alternating structural thoughts and tool results into one activity run', () => {
    const messages = normalizeSessionMessages([
      { id: 'a1', role: 'assistant', content: '', reasoning: 'Inspect the source.', timestamp: 1 },
      { id: 't1', role: 'tool', tool_name: 'read_file', content: 'source', timestamp: 2 },
      { id: 'a2', role: 'assistant', content: '', reasoning: 'Run the test.', timestamp: 3 },
      { id: 't2', role: 'tool', tool_name: 'terminal', content: 'passed', timestamp: 5 },
      { id: 'a3', role: 'assistant', content: 'Done.', timestamp: 6 },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      role: 'tool',
      activityThoughts: [
        { id: 'a1', content: 'Inspect the source.', durationSeconds: 1 },
        { id: 'a2', content: 'Run the test.', durationSeconds: 2 },
      ],
      toolResults: [
        { id: 't1', name: 'read_file' },
        { id: 't2', name: 'terminal' },
      ],
    })
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Done.' })
  })

  it('keeps a persisted inline tool diff for the diff viewer', () => {
    const diff = '--- a/src/App.ts\n+++ b/src/App.ts\n@@ -1 +1 @@\n-old\n+new'
    const messages = normalizeSessionMessages([
      { id: 't1', role: 'tool', tool_name: 'patch', content: 'completed', inline_diff: diff, timestamp: 1 },
      { id: 't2', role: 'tool', tool_name: 'patch', content: 'completed', diff, timestamp: 2 },
    ])

    expect(messages[0]?.toolResults?.[0]).toMatchObject({ name: 'patch', diff })
    expect(messages[0]?.toolResults?.[1]).toMatchObject({ name: 'patch', diff })
  })

  it('hides transport-only context compaction records', () => {
    const messages = normalizeSessionMessages([
      { id: 'c1', role: 'user', content: '[CONTEXT COMPACTION — REFERENCE ONLY]\nHistorical summary', timestamp: 1 },
      { id: 'u1', role: 'user', content: 'Actual user prompt', timestamp: 2 },
    ])

    expect(messages).toEqual([expect.objectContaining({ id: 'u1', content: 'Actual user prompt' })])
  })

  it('renders portable image parts and retains gateway image paths for remote retrieval', () => {
    const messages = normalizeSessionMessages([
      {
        id: 'u1',
        role: 'user',
        content: [
          { type: 'text', text: 'Please inspect this.\n\n[Image attached at: /home/hermes/.hermes/images/shot.png]' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,cGl4ZWxz' } },
        ],
        timestamp: 1,
      },
      {
        id: 'u2',
        role: 'user',
        content: 'This came from the gateway.\n\n@image:/home/hermes/.hermes/images/desktop-only.png [screenshot]',
        timestamp: 2,
      },
      {
        id: 'u3',
        role: 'user',
        content: '[Image attached at: /tmp/image-only.png]',
        timestamp: 3,
      },
    ])

    expect(messages[0]).toMatchObject({
      content: 'Please inspect this.',
      imageAttachments: [{ label: 'Image 1', src: 'data:image/png;base64,cGl4ZWxz' }],
    })
    expect(messages[1]).toMatchObject({
      content: 'This came from the gateway.',
      imageAttachments: [{ label: 'Image 1', gatewayPath: '/home/hermes/.hermes/images/desktop-only.png' }],
    })
    expect(messages[2]).toMatchObject({
      content: '',
      imageAttachments: [{ label: 'Image 1', gatewayPath: '/tmp/image-only.png' }],
    })
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

  it('marks the optimistic assistant response as retryable while retaining streamed text', () => {
    const messages = [
      { role: 'user' as const, content: 'Build it', timestamp: 1 },
      { role: 'assistant' as const, content: 'I started the implementation.', timestamp: 2 },
    ]

    markLatestAssistantFailure(messages, 'Provider rate limit exceeded')

    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: 'I started the implementation.',
      error: true,
    })
  })

  it('keeps partial output but removes an empty assistant placeholder after stop', () => {
    const partial = [
      { role: 'user' as const, content: 'Build it', timestamp: 1 },
      { role: 'assistant' as const, content: 'Partial output', timestamp: 2 },
    ]
    const empty = [
      { role: 'user' as const, content: 'Build it', timestamp: 1 },
      { role: 'assistant' as const, content: '', timestamp: 2 },
    ]

    expect(finalizeInterruptedMessages(partial, 1)).toEqual(partial)
    expect(finalizeInterruptedMessages(empty, 1)).toEqual([empty[0]])
  })

  it('does not remove a non-assistant row when the stream index is stale', () => {
    const messages = [
      { role: 'user' as const, content: 'Build it', timestamp: 1 },
      { role: 'tool' as const, content: '', timestamp: 2 },
    ]

    expect(finalizeInterruptedMessages(messages, 1)).toEqual(messages)
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

  it('retains the selected user checkpoint while removing its old response branch', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'First prompt', timestamp: 1 },
      { id: 'a1', role: 'assistant' as const, content: 'First response', timestamp: 2 },
      { id: 'u2', role: 'user' as const, content: 'Retry this prompt', timestamp: 3 },
      { id: 'a2', role: 'assistant' as const, content: 'Old retry response', timestamp: 4 },
      { id: 't1', role: 'tool' as const, content: 'Old activity', timestamp: 5 },
    ]

    expect(rewindToMessage(messages, 2)).toEqual(messages.slice(0, 3))
    expect(rewindToMessage(messages, -1)).toEqual(messages)
    expect(messages).toHaveLength(5)
  })

  it('discards an edited prompt’s complete old response branch before streaming its replacement', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'Original prompt', timestamp: 1 },
      { id: 'a1', role: 'assistant' as const, content: 'Old response', timestamp: 2 },
      { id: 't1', role: 'tool' as const, content: 'Old activity', timestamp: 3 },
      { id: 'u2', role: 'user' as const, content: 'Later prompt', timestamp: 4 },
    ]

    expect(applyEditedUserTurn(messages, 0, 'Edited prompt')).toEqual([
      { id: 'u1', role: 'user', content: 'Edited prompt', timestamp: 1 },
    ])
    expect(messages[0].content).toBe('Original prompt')
  })

  it('uses the visible user ordinal when restoring an earlier checkpoint', () => {
    const messages = [
      { role: 'user' as const },
      { role: 'assistant' as const },
      { role: 'tool' as const },
      { role: 'user' as const },
      { role: 'assistant' as const },
    ]

    expect(userOrdinalAtMessageIndex(messages, 0)).toBe(0)
    expect(userOrdinalAtMessageIndex(messages, 3)).toBe(1)
    expect(userOrdinalAtMessageIndex(messages, 1)).toBeNull()
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

  it('creates branch history from visible conversational turns without tool records', () => {
    const messages = [
      { role: 'user' as const, content: 'Investigate the gateway', timestamp: 1 },
      { role: 'assistant' as const, content: 'I will inspect the connection flow.', timestamp: 2 },
      { role: 'tool' as const, content: 'socket connected', timestamp: 3 },
      { role: 'assistant' as const, content: 'The cookie is required.', timestamp: 4 },
      { role: 'assistant' as const, content: '   ', timestamp: 5 },
    ]

    expect(branchableMessageHistory(messages)).toEqual([
      { role: 'user', content: 'Investigate the gateway' },
      { role: 'assistant', content: 'I will inspect the connection flow.' },
      { role: 'assistant', content: 'The cookie is required.' },
    ])
  })

  it('keeps the full conversational spine through the selected assistant turn', () => {
    const messages = [
      { role: 'user' as const, content: 'First prompt', timestamp: 1 },
      { role: 'assistant' as const, content: 'First response', timestamp: 2 },
      { role: 'tool' as const, content: 'Hidden activity', timestamp: 3 },
      { role: 'user' as const, content: 'Follow-up prompt', timestamp: 4 },
      { role: 'assistant' as const, content: 'Selected response', timestamp: 5 },
      { role: 'user' as const, content: 'Later prompt', timestamp: 6 },
    ]

    expect(branchableMessageHistoryThrough(messages, 4)).toEqual([
      { role: 'user', content: 'First prompt' },
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Follow-up prompt' },
      { role: 'assistant', content: 'Selected response' },
    ])
    expect(branchableMessageHistoryThrough(messages, 99)).toEqual([])
  })
})
