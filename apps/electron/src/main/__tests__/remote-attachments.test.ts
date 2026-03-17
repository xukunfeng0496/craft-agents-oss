import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

class FakeWorker {
  private listeners = new Map<string, Array<(value: any) => void>>()

  constructor(_code: string, _options: unknown) {
    setTimeout(() => {
      this.emit('message', { textContent: '# Remote office conversion\n\nConverted body' })
      this.emit('exit', 0)
    }, 0)
  }

  on(event: string, listener: (value: any) => void) {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }

  terminate() {
    this.emit('exit', 0)
  }

  private emit(event: string, value: any) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value)
    }
  }
}

mock.module('electron', () => ({
  nativeImage: {
    createFromBuffer: () => ({
      getSize: () => ({ width: 100, height: 100 }),
      resize: () => ({
        toJPEG: () => Buffer.from('jpeg'),
        toPNG: () => Buffer.from('png'),
      }),
    }),
    createThumbnailFromPath: async () => ({
      isEmpty: () => true,
      toPNG: () => Buffer.from(''),
    }),
  },
}))

mock.module('worker_threads', () => ({
  Worker: FakeWorker,
}))

const { processRemoteAttachments } = await import('../remote-attachments')

describe('processRemoteAttachments', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    for (const path of cleanupPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('accepts office attachments and preserves markdownPath', async () => {
    const workspaceRootPath = mkdtempSync(join(tmpdir(), 'work-agent-remote-att-'))
    cleanupPaths.push(workspaceRootPath)

    const result = await processRemoteAttachments(
      workspaceRootPath,
      '260316-remote-session',
      [{
        type: 'office',
        name: 'sheet.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from('xlsx').toString('base64'),
        size: 4,
      }],
      { info: () => {}, warn: () => {} },
    )

    expect(result.droppedCount).toBe(0)
    expect(result.attachments).toHaveLength(1)
    expect(result.storedAttachments).toHaveLength(1)
    expect(result.attachments?.[0]?.markdownPath).toBeDefined()
    expect(result.storedAttachments?.[0]?.markdownPath).toBeDefined()
  })

  it('drops invalid remote attachment types', async () => {
    const workspaceRootPath = mkdtempSync(join(tmpdir(), 'work-agent-remote-att-'))
    cleanupPaths.push(workspaceRootPath)

    const result = await processRemoteAttachments(
      workspaceRootPath,
      '260316-remote-session',
      [{
        type: 'zip',
        name: 'archive.zip',
        mimeType: 'application/zip',
        base64: Buffer.from('zip').toString('base64'),
        size: 3,
      }],
      { info: () => {}, warn: () => {} },
    )

    expect(result.droppedCount).toBe(1)
    expect(result.attachments).toHaveLength(0)
    expect(result.storedAttachments).toHaveLength(0)
  })
})
