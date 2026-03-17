import { describe, expect, it } from 'bun:test'

import { getConnectionModelCapabilities } from '../llm-connections.ts'

describe('getConnectionModelCapabilities', () => {
  it('merges default and per-model overrides', () => {
    const capabilities = getConnectionModelCapabilities({
      capabilities: {
        default: {
          supportsToolUse: true,
          supportsStructuredOutput: false,
        },
        byModel: {
          'CVTE-AUTO': {
            supportsVision: true,
            supportsDocumentBlocks: false,
          },
        },
      },
    }, 'CVTE-AUTO')

    expect(capabilities).toEqual({
      supportsToolUse: true,
      supportsStructuredOutput: false,
      supportsVision: true,
      supportsDocumentBlocks: false,
    })
  })

  it('matches model ids case-insensitively', () => {
    const capabilities = getConnectionModelCapabilities({
      capabilities: {
        byModel: {
          'cvte-auto': {
            supportsVision: true,
          },
        },
      },
    }, 'CVTE-AUTO')

    expect(capabilities).toEqual({ supportsVision: true })
  })

  it('returns undefined when no overrides exist', () => {
    expect(getConnectionModelCapabilities(undefined, 'CVTE-AUTO')).toBeUndefined()
  })
})
