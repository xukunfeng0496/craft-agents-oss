import { describe, expect, it } from 'bun:test'

import { createConfigFromConnection } from '../backend/factory.ts'

describe('createConfigFromConnection', () => {
  it('propagates connection-level capability overrides for the resolved model', () => {
    const config = createConfigFromConnection({
      slug: 'anthropic-compat',
      name: 'Anthropic Compat',
      providerType: 'anthropic_compat',
      authType: 'api_key_with_endpoint',
      defaultModel: 'CVTE-AUTO',
      capabilities: {
        byModel: {
          'CVTE-AUTO': {
            supportsVision: true,
            supportsDocumentBlocks: false,
          },
        },
      },
      createdAt: Date.now(),
    }, {
      workspace: {
        id: 'ws-1',
        name: 'Workspace',
        rootPath: '/tmp',
        createdAt: Date.now(),
      },
    })

    expect(config.model).toBe('CVTE-AUTO')
    expect(config.modelCapabilities).toEqual({
      supportsVision: true,
      supportsDocumentBlocks: false,
    })
  })
})
