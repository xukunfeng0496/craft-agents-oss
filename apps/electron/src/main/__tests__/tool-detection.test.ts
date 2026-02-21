// apps/electron/src/main/__tests__/tool-detection.test.ts
import { describe, it, expect } from 'bun:test'

// Integration test — checks that detectMissingTools returns
// the expected shape regardless of which tools are installed.
import { detectMissingTools } from '../tool-detection'

describe('detectMissingTools', () => {
  it('returns exactly two tool results with correct ids', async () => {
    const results = await detectMissingTools()
    expect(results).toHaveLength(2)

    const ids = results.map(r => r.id).sort()
    expect(ids).toEqual(['git', 'python'])
  })

  it('each result has a boolean found field', async () => {
    const results = await detectMissingTools()
    for (const result of results) {
      expect(typeof result.found).toBe('boolean')
    }
  })
})
