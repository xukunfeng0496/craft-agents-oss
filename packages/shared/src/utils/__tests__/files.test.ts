import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileAttachment } from '../files.ts'

describe('readFileAttachment', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    for (const path of cleanupPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('returns metadata for large local text files without eagerly loading content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-agent-files-test-'))
    cleanupPaths.push(dir)

    const filePath = join(dir, 'large.log')
    writeFileSync(filePath, '')
    truncateSync(filePath, 21 * 1024 * 1024)

    const attachment = readFileAttachment(filePath)

    expect(attachment).not.toBeNull()
    expect(attachment?.type).toBe('text')
    expect(attachment?.size).toBe(21 * 1024 * 1024)
    expect(attachment?.text).toBeUndefined()
    expect(attachment?.base64).toBeUndefined()
  })
})
