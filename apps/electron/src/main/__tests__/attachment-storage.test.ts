import { afterEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

class FakeWorker {
  private listeners = new Map<string, Array<(value: any) => void>>()

  constructor(_code: string, _options: unknown) {
    setTimeout(() => {
      this.emit('message', { textContent: '# Converted office content\n\n| A | B |\n| - | - |\n| 1 | 2 |' })
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

const { storeAttachmentOnDisk } = await import('../attachment-storage')

describe('storeAttachmentOnDisk', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    for (const path of cleanupPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('creates markdown sidecar for office attachments', async () => {
    const workspaceRootPath = mkdtempSync(join(tmpdir(), 'work-agent-att-test-'))
    cleanupPaths.push(workspaceRootPath)

    const attachment = {
      type: 'office' as const,
      path: '',
      name: 'report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: Buffer.from('xlsx').toString('base64'),
      size: 4,
    }

    const result = await storeAttachmentOnDisk({
      workspaceRootPath,
      sessionId: '260316-test-session',
      attachment,
      logger: {
        info: () => {},
        warn: () => {},
      },
    })

    expect(result.storedPath).toContain('report.xlsx')
    expect(existsSync(result.storedPath)).toBe(true)
    expect(result.markdownPath).toBeDefined()
    expect(result.markdownPath && existsSync(result.markdownPath)).toBe(true)
    expect(readFileSync(result.markdownPath!, 'utf-8')).toContain('Converted office content')
  })
})
