import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { Session } from '../../../shared/types'
import { sessionAtomFamily, updateStreamingContentAtom } from '../sessions'

function makeSession(messages: Session['messages']): Session {
  return {
    id: 'session-1',
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace',
    lastMessageAt: 1,
    messages,
    isProcessing: true,
  }
}

describe('session streaming atoms', () => {
  it('appends text_delta to a streaming assistant message even when it is not the last message', () => {
    const store = createStore()
    store.set(sessionAtomFamily('session-1'), makeSession([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'hello',
        timestamp: 1,
        isStreaming: true,
        turnId: 'turn-1',
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: 2,
        toolUseId: 'tool-1',
        toolName: 'Read',
        toolStatus: 'executing',
        turnId: 'turn-1',
      },
    ]))

    store.set(updateStreamingContentAtom, 'session-1', ' world', 'turn-1')

    const updatedSession = store.get(sessionAtomFamily('session-1'))
    expect(updatedSession?.messages[0]?.content).toBe('hello world')
    expect(updatedSession?.messages[1]?.toolStatus).toBe('executing')
  })

  it('falls back to the last streaming assistant when turnId is omitted', () => {
    const store = createStore()
    store.set(sessionAtomFamily('session-1'), makeSession([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'part',
        timestamp: 1,
        isStreaming: true,
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: '',
        timestamp: 2,
        toolUseId: 'tool-1',
        toolName: 'Read',
        toolStatus: 'completed',
      },
    ]))

    store.set(updateStreamingContentAtom, 'session-1', 'ial')

    const updatedSession = store.get(sessionAtomFamily('session-1'))
    expect(updatedSession?.messages[0]?.content).toBe('partial')
  })
})
