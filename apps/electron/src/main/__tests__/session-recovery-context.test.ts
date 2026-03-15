import { describe, expect, it } from 'bun:test'

import { buildRecoveryMessages } from '../session-recovery-context'

describe('buildRecoveryMessages', () => {
  it('excludes the current in-flight user message from recovery history', () => {
    const recoveryMessages = buildRecoveryMessages([
      {
        role: 'user',
        content: '',
        attachments: [
          {
            id: 'att-1',
            type: 'pdf',
            name: 'resume.pdf',
            mimeType: 'application/pdf',
            size: 1234,
            storedPath: '/tmp/session/att-1_resume.pdf',
          },
        ],
        isIntermediate: false,
      },
      {
        role: 'assistant',
        content: '我先看一下这个文件。',
        attachments: undefined,
        isIntermediate: false,
      },
      {
        role: 'user',
        content: '重点看第二页',
        attachments: undefined,
        isIntermediate: false,
      },
    ])

    expect(recoveryMessages).toHaveLength(2)
    expect(recoveryMessages[0]).toEqual({
      type: 'user',
      content: '[Attached file: resume.pdf]\n[Stored at: /tmp/session/att-1_resume.pdf]',
    })
    expect(recoveryMessages[1]).toEqual({
      type: 'assistant',
      content: '我先看一下这个文件。',
    })
  })

  it('keeps the last assistant reply when the trailing message is not a user turn', () => {
    const recoveryMessages = buildRecoveryMessages([
      {
        role: 'user',
        content: '先总结一下',
        attachments: undefined,
        isIntermediate: false,
      },
      {
        role: 'assistant',
        content: '这里是总结。',
        attachments: undefined,
        isIntermediate: false,
      },
    ])

    expect(recoveryMessages).toEqual([
      { type: 'user', content: '先总结一下' },
      { type: 'assistant', content: '这里是总结。' },
    ])
  })
})
