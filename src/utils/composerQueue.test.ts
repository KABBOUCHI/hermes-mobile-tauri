import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendQueuedMessage,
  clearQueuedMessages,
  dequeueQueuedMessage,
  getQueuedMessages,
  isQueuePaused,
  migrateQueuedMessages,
  pauseQueuedMessages,
  removeQueuedMessage,
  resetQueuedMessageStore,
  resumeQueuedMessages,
  setQueuedMessages,
} from './composerQueue'

const SESSION_ID = 'session-1'

beforeEach(() => {
  resetQueuedMessageStore()
})

describe('composer queue', () => {
  it('keeps queued prompts FIFO and clones attachments', () => {
    const attachments = [{
      id: 'file-1',
      kind: 'file' as const,
      name: 'notes.txt',
      mimeType: 'text/plain',
      dataUrl: 'data:text/plain;base64,SGk=',
      size: 2,
    }]

    const first = appendQueuedMessage([], 'first', attachments, { id: 'q-1', queuedAt: 10 })
    const second = appendQueuedMessage(first.queue, 'second', [], { id: 'q-2', queuedAt: 20 })

    expect(second.queue.map(entry => entry.text)).toEqual(['first', 'second'])
    expect(second.queue[0]?.attachments[0]).toEqual(attachments[0])
    expect(second.queue[0]?.attachments[0]).not.toBe(attachments[0])
  })

  it('dequeues only the head and leaves the remainder intact', () => {
    const first = appendQueuedMessage([], 'first', [], { id: 'q-1', queuedAt: 10 })
    const second = appendQueuedMessage(first.queue, 'second', [], { id: 'q-2', queuedAt: 20 })

    const result = dequeueQueuedMessage(second.queue)

    expect(result.entry?.text).toBe('first')
    expect(result.queue.map(entry => entry.text)).toEqual(['second'])
  })

  it('removes a queued prompt without disturbing the others', () => {
    const first = appendQueuedMessage([], 'first', [], { id: 'q-1', queuedAt: 10 })
    const second = appendQueuedMessage(first.queue, 'second', [], { id: 'q-2', queuedAt: 20 })

    expect(removeQueuedMessage(second.queue, 'q-1').map(entry => entry.text)).toEqual(['second'])
    expect(removeQueuedMessage(second.queue, 'missing')).toEqual(second.queue)
  })
})

describe('per-session queue store', () => {
  it('stores and clears queues independently by session', () => {
    const queued = appendQueuedMessage([], 'keep this', [], { id: 'q-1', queuedAt: 10 }).queue
    setQueuedMessages(SESSION_ID, queued)
    setQueuedMessages('session-2', appendQueuedMessage([], 'other', [], { id: 'q-2', queuedAt: 20 }).queue)

    expect(getQueuedMessages(SESSION_ID).map(entry => entry.text)).toEqual(['keep this'])
    clearQueuedMessages(SESSION_ID)
    expect(getQueuedMessages(SESSION_ID)).toEqual([])
    expect(getQueuedMessages('session-2').map(entry => entry.text)).toEqual(['other'])
  })

  it('moves a queue and its paused state when a new session id is assigned', () => {
    const queued = appendQueuedMessage([], 'waiting', [], { id: 'q-1', queuedAt: 10 }).queue
    setQueuedMessages('client-id', queued)
    pauseQueuedMessages('client-id')

    expect(migrateQueuedMessages('client-id', 'stored-id')).toBe(true)
    expect(getQueuedMessages('client-id')).toEqual([])
    expect(getQueuedMessages('stored-id').map(entry => entry.text)).toEqual(['waiting'])
    expect(isQueuePaused('client-id')).toBe(false)
    expect(isQueuePaused('stored-id')).toBe(true)

    resumeQueuedMessages('stored-id')
    expect(isQueuePaused('stored-id')).toBe(false)
  })
})
