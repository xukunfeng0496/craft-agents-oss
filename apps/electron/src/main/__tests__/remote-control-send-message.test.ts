import { describe, expect, it, mock } from 'bun:test'

import type { FileAttachment, StoredAttachment } from '../../shared/types'
import { handleRemoteSendMessage } from '../remote-control-send-message'

describe('handleRemoteSendMessage', () => {
  it('forwards processed attachments and storedAttachments to sendMessage', async () => {
    const sendMessage = mock(async (
      _sessionId: string,
      _content: string,
      _attachments?: FileAttachment[],
      _storedAttachments?: StoredAttachment[],
    ) => {})
    const processAttachments = mock(async (
      _workspaceRootPath: string,
      _sessionId: string,
      _rawAttachments: unknown,
      _logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
    ) => {
      const attachments: FileAttachment[] = [{
        type: 'office',
        path: '/tmp/sheet.xlsx',
        storedPath: '/tmp/sheet.xlsx',
        markdownPath: '/tmp/sheet.xlsx.md',
        name: 'sheet.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 12,
      }]
      const storedAttachments: StoredAttachment[] = [{
        id: 'att-1',
        type: 'office',
        name: 'sheet.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 12,
        storedPath: '/tmp/sheet.xlsx',
        markdownPath: '/tmp/sheet.xlsx.md',
        wasResized: false,
      }]
      return { attachments, storedAttachments, droppedCount: 0 }
    })

    await handleRemoteSendMessage({
      sessionId: 'remote-session-1',
      workspaceRootPath: '/tmp/workspace',
      content: 'please summarize this sheet',
      rawAttachments: [{
        type: 'office',
        name: 'sheet.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from('xlsx').toString('base64'),
        size: 4,
      }],
      logger: { warn: () => {} },
      sendMessage,
      processAttachments,
    })

    expect(processAttachments).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0]).toEqual([
      'remote-session-1',
      'please summarize this sheet',
      [{
        type: 'office',
        path: '/tmp/sheet.xlsx',
        storedPath: '/tmp/sheet.xlsx',
        markdownPath: '/tmp/sheet.xlsx.md',
        name: 'sheet.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 12,
      }],
      [{
        id: 'att-1',
        type: 'office',
        name: 'sheet.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 12,
        storedPath: '/tmp/sheet.xlsx',
        markdownPath: '/tmp/sheet.xlsx.md',
        wasResized: false,
      }],
    ])
  })

  it('warns when attachments are dropped and still sends the message', async () => {
    const warn = mock((..._args: unknown[]) => {})
    const sendMessage = mock(async (
      _sessionId: string,
      _content: string,
      _attachments?: FileAttachment[],
      _storedAttachments?: StoredAttachment[],
    ) => {})
    const processAttachments = mock(async (
      _workspaceRootPath: string,
      _sessionId: string,
      _rawAttachments: unknown,
      _logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
    ) => ({
      attachments: [],
      storedAttachments: [],
      droppedCount: 2,
    }))

    await handleRemoteSendMessage({
      sessionId: 'remote-session-2',
      workspaceRootPath: '/tmp/workspace',
      content: 'continue',
      rawAttachments: [{
        type: 'zip',
        name: 'bad.zip',
        mimeType: 'application/zip',
        base64: Buffer.from('zip').toString('base64'),
        size: 3,
      }],
      logger: { warn },
      sendMessage,
      processAttachments,
    })

    expect(warn).toHaveBeenCalledTimes(1)
    const firstWarnCall = warn.mock.calls[0] as unknown[] | undefined
    expect(String(firstWarnCall?.[0])).toContain('Dropped 2 invalid/oversized attachments')
    expect(sendMessage).toHaveBeenCalledWith('remote-session-2', 'continue', [], [])
  })

  it('skips processing when content is empty', async () => {
    const sendMessage = mock(async (
      _sessionId: string,
      _content: string,
      _attachments?: FileAttachment[],
      _storedAttachments?: StoredAttachment[],
    ) => {})
    const processAttachments = mock(async (
      _workspaceRootPath: string,
      _sessionId: string,
      _rawAttachments: unknown,
      _logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void },
    ) => ({
      attachments: [],
      storedAttachments: [],
      droppedCount: 0,
    }))

    await handleRemoteSendMessage({
      sessionId: 'remote-session-3',
      workspaceRootPath: '/tmp/workspace',
      content: '',
      rawAttachments: [{
        type: 'text',
        name: 'note.txt',
        mimeType: 'text/plain',
        text: 'hello',
        size: 5,
      }],
      logger: { warn: () => {} },
      sendMessage,
      processAttachments,
    })

    expect(processAttachments).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
