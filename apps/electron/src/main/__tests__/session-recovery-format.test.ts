import { describe, expect, it } from 'bun:test'

import { formatMessageForRecoveryContext } from '../session-recovery-format'

describe('formatMessageForRecoveryContext', () => {
  it('includes attachment paths for user messages without text', () => {
    const content = formatMessageForRecoveryContext({
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
          markdownPath: '/tmp/session/att-1_resume.md',
        },
      ],
    })

    expect(content).toContain('[Attached file: resume.pdf]')
    expect(content).toContain('[Stored at: /tmp/session/att-1_resume.pdf]')
    expect(content).toContain('[Markdown version: /tmp/session/att-1_resume.md]')
  })

  it('keeps regular text messages unchanged when there are no attachments', () => {
    const content = formatMessageForRecoveryContext({
      role: 'user',
      content: '帮我看看这个pdf',
      attachments: undefined,
    })

    expect(content).toBe('帮我看看这个pdf')
  })
})
