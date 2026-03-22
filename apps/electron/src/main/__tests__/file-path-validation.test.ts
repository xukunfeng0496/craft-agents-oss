import { describe, expect, it } from 'bun:test'
import path from 'node:path'
import { validateAttachmentPath, validateTrustedFileAccessPath } from '../file-path-validation'

describe('file-path-validation', () => {
  it('allows attachment paths from external trusted volumes', async () => {
    const result = await validateAttachmentPath('/Volumes/External/report.pdf', {
      realpathFn: async (filePath) => filePath,
    })

    expect(result).toBe('/Volumes/External/report.pdf')
  })

  it('allows strict access within an explicit workspace root outside home', async () => {
    const result = await validateTrustedFileAccessPath('/Volumes/Project/src/index.ts', {
      allowedRoots: ['/Volumes/Project'],
      homeDir: '/Users/tester',
      realpathFn: async (filePath) => filePath,
      tempDir: '/tmp',
    })

    expect(result).toBe('/Volumes/Project/src/index.ts')
  })

  it('rejects strict access outside trusted roots', async () => {
    await expect(validateTrustedFileAccessPath('/Volumes/Elsewhere/secret.txt', {
      allowedRoots: ['/Volumes/Project'],
      homeDir: '/Users/tester',
      realpathFn: async (filePath) => filePath,
      tempDir: '/tmp',
    })).rejects.toThrow('Access denied: file path is outside allowed directories')
  })

  it('rejects relative paths for attachments', async () => {
    await expect(validateAttachmentPath('notes/todo.md', {
      realpathFn: async (filePath) => filePath,
    })).rejects.toThrow('Only absolute file paths are allowed')
  })

  it('rejects sensitive files after resolving symlinks', async () => {
    await expect(validateAttachmentPath('/tmp/link-to-secret', {
      realpathFn: async () => '/Users/tester/.ssh/id_ed25519',
    })).rejects.toThrow('Access denied: cannot read sensitive files')
  })

  it('normalizes Windows separators before sensitive-path checks', async () => {
    await expect(validateAttachmentPath('D:\\Users\\tester\\.aws\\credentials', {
      caseInsensitiveComparison: true,
      pathApi: path.win32,
      realpathFn: async (filePath) => filePath,
    })).rejects.toThrow('Access denied: cannot read sensitive files')
  })

  it('allows Windows attachment paths on non-system drives', async () => {
    const result = await validateAttachmentPath('D:\\Work\\docs\\spec.docx', {
      caseInsensitiveComparison: true,
      pathApi: path.win32,
      realpathFn: async (filePath) => filePath,
    })

    expect(result).toBe('D:\\Work\\docs\\spec.docx')
  })

  it('matches workspace roots case-insensitively on Windows', async () => {
    const result = await validateTrustedFileAccessPath('D:\\Work\\Repo\\src\\main.ts', {
      allowedRoots: ['d:\\work\\repo'],
      caseInsensitiveComparison: true,
      homeDir: 'C:\\Users\\tester',
      pathApi: path.win32,
      realpathFn: async (filePath) => filePath,
      tempDir: 'C:\\Temp',
    })

    expect(result).toBe('D:\\Work\\Repo\\src\\main.ts')
  })
})
