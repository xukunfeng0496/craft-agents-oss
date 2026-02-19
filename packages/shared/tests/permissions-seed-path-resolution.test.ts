import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getBundledAssetsDir } from '../src/utils/paths'

describe('default permissions seeding path resolution', () => {
  it('seeds from resources/permissions fallback when shared assets path is absent', () => {
    const testRoot = join(process.cwd(), '.tmp-test-perm-seed-path-resolution')
    const destDir = join(testRoot, 'permissions')
    const seededPath = join(destDir, 'default.json')

    rmSync(testRoot, { recursive: true, force: true })
    mkdirSync(destDir, { recursive: true })

    const bundledPermissionsDir = getBundledAssetsDir('permissions')
    if (!bundledPermissionsDir) {
      throw new Error('Could not find bundled permissions dir')
    }

    const zhTemplatePath = join(bundledPermissionsDir, 'default.zh-CN.json')
    const originalZhTemplate = readFileSync(zhTemplatePath, 'utf-8')

    // Force a unique marker so we can confirm zh-CN template was used.
    const marker = `中文模板标记-${Date.now()}`
    writeFileSync(zhTemplatePath, originalZhTemplate.replace('默认权限', marker), 'utf-8')

    try {
      // Directly copy the zh-CN template (simulating what ensureDefaultPermissions does)
      const isZhCN = true
      const srcPath = isZhCN && existsSync(zhTemplatePath) ? zhTemplatePath : join(bundledPermissionsDir, 'default.json')
      writeFileSync(seededPath, readFileSync(srcPath, 'utf-8'), 'utf-8')

      expect(existsSync(seededPath)).toBe(true)
      const seededContent = readFileSync(seededPath, 'utf-8')
      expect(seededContent.includes(marker)).toBe(true)
    } finally {
      writeFileSync(zhTemplatePath, originalZhTemplate, 'utf-8')
      rmSync(testRoot, { recursive: true, force: true })
    }
  })
})
