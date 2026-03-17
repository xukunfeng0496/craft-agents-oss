import { describe, expect, it } from 'bun:test'

import type { LlmConnection } from '../llm-connections.ts'
import {
  applyCapabilityPatchToConfig,
  applyCapabilityPatchToConnection,
  buildConnectionCapabilityPatch,
  buildModelCapabilityOverrides,
  mergeConnectionCapabilityPatch,
  summarizeConnectionCapabilityChanges,
  type CapabilityReportFile,
} from '../model-capability-report.ts'

describe('buildModelCapabilityOverrides', () => {
  it('maps probe pass and fail states into capability booleans', () => {
    const overrides = buildModelCapabilityOverrides({
      model: 'glm-4.7',
      profile: 'tool-agent-compatible',
      probes: [
        { name: 'tool_use', status: 'pass', durationMs: 1, summary: 'ok' },
        { name: 'structured_output', status: 'pass', durationMs: 1, summary: 'ok' },
        { name: 'multi_turn_tool_loop', status: 'fail', durationMs: 1, summary: 'nope' },
        { name: 'pdf_document', status: 'pass', durationMs: 1, summary: 'ok' },
      ],
    })

    expect(overrides).toEqual({
      supportsToolUse: true,
      supportsStructuredOutput: true,
      supportsMultiTurnToolLoop: false,
      supportsDocumentBlocks: true,
    })
  })
})

describe('buildConnectionCapabilityPatch', () => {
  const reportFile: CapabilityReportFile = {
    generatedAt: '2026-03-16T00:00:00.000Z',
    baseUrl: 'https://example.com',
    authMode: 'api-key',
    reports: [
      {
        model: 'glm-4.7',
        profile: 'tool-agent-compatible',
        probes: [
          { name: 'tool_use', status: 'pass', durationMs: 1, summary: 'ok' },
          { name: 'structured_output', status: 'pass', durationMs: 1, summary: 'ok' },
          { name: 'multi_turn_tool_loop', status: 'fail', durationMs: 1, summary: 'nope' },
          { name: 'pdf_document', status: 'pass', durationMs: 1, summary: 'ok' },
        ],
      },
      {
        model: 'glm-5',
        profile: 'basic-tool-compatible',
        probes: [
          { name: 'tool_use', status: 'pass', durationMs: 1, summary: 'ok' },
          { name: 'structured_output', status: 'fail', durationMs: 1, summary: 'nope' },
          { name: 'multi_turn_tool_loop', status: 'fail', durationMs: 1, summary: 'nope' },
          { name: 'pdf_document', status: 'fail', durationMs: 1, summary: 'nope' },
        ],
      },
    ],
  }

  it('builds by-model capability patches from the probe report', () => {
    expect(buildConnectionCapabilityPatch(reportFile)).toEqual({
      capabilities: {
        byModel: {
          'glm-4.7': {
            supportsToolUse: true,
            supportsStructuredOutput: true,
            supportsMultiTurnToolLoop: false,
            supportsDocumentBlocks: true,
          },
          'glm-5': {
            supportsToolUse: true,
            supportsStructuredOutput: false,
            supportsMultiTurnToolLoop: false,
            supportsDocumentBlocks: false,
          },
        },
      },
    })
  })

  it('filters to selected models when requested', () => {
    expect(buildConnectionCapabilityPatch(reportFile, ['glm-5'])).toEqual({
      capabilities: {
        byModel: {
          'glm-5': {
            supportsToolUse: true,
            supportsStructuredOutput: false,
            supportsMultiTurnToolLoop: false,
            supportsDocumentBlocks: false,
          },
        },
      },
    })
  })
})

describe('mergeConnectionCapabilityPatch', () => {
  it('preserves existing defaults and merges byModel updates', () => {
    const merged = mergeConnectionCapabilityPatch({
      default: {
        supportsVision: false,
      },
      byModel: {
        'CVTE-AUTO': {
          supportsDocumentBlocks: false,
        },
      },
    }, {
      capabilities: {
        byModel: {
          'glm-4.7': {
            supportsDocumentBlocks: true,
          },
        },
      },
    })

    expect(merged).toEqual({
      default: {
        supportsVision: false,
      },
      byModel: {
        'CVTE-AUTO': {
          supportsDocumentBlocks: false,
        },
        'glm-4.7': {
          supportsDocumentBlocks: true,
        },
      },
    })
  })
})

describe('applyCapabilityPatchToConnection', () => {
  it('returns a connection with merged capabilities', () => {
    const updated = applyCapabilityPatchToConnection({
      slug: 'anthropic-compat',
      name: 'Anthropic Compat',
      providerType: 'anthropic_compat',
      authType: 'api_key_with_endpoint',
      createdAt: 1,
      capabilities: {
        default: {
          supportsVision: false,
        },
      },
    }, {
      capabilities: {
        byModel: {
          'glm-4.7': {
            supportsDocumentBlocks: true,
          },
        },
      },
    })

    expect(updated.capabilities).toEqual({
      default: {
        supportsVision: false,
      },
      byModel: {
        'glm-4.7': {
          supportsDocumentBlocks: true,
        },
      },
    })
  })
})

describe('applyCapabilityPatchToConfig', () => {
  it('updates only the targeted connection slug', () => {
    const config: { llmConnections: LlmConnection[] } = {
      llmConnections: [
        {
          slug: 'target',
          name: 'Target',
          providerType: 'anthropic_compat' as const,
          authType: 'api_key_with_endpoint' as const,
          createdAt: 1,
        },
        {
          slug: 'other',
          name: 'Other',
          providerType: 'anthropic' as const,
          authType: 'api_key' as const,
          createdAt: 2,
          capabilities: {
            byModel: {
              foo: {
                supportsToolUse: true,
              },
            },
          },
        },
      ],
    }

    const updated = applyCapabilityPatchToConfig(config, 'target', {
      capabilities: {
        byModel: {
          'CVTE-AUTO': {
            supportsStructuredOutput: false,
          },
        },
      },
    })

    expect(updated.llmConnections?.[0]?.capabilities?.default).toEqual({})
    expect(updated.llmConnections?.[0]?.capabilities?.byModel?.['CVTE-AUTO']?.supportsStructuredOutput).toBe(false)
    expect(updated.llmConnections?.[1]?.capabilities?.byModel?.foo?.supportsToolUse).toBe(true)
  })

  it('throws when the target connection is missing', () => {
    expect(() => applyCapabilityPatchToConfig({
      llmConnections: [],
    }, 'missing', {
      capabilities: {
        byModel: {},
      },
    })).toThrow('No llmConnections found in config')
  })
})

describe('summarizeConnectionCapabilityChanges', () => {
  it('reports changed default and per-model flags', () => {
    const summary = summarizeConnectionCapabilityChanges({
      default: {
        supportsVision: false,
      },
      byModel: {
        'glm-4.7': {
          supportsDocumentBlocks: false,
        },
      },
    }, {
      default: {
        supportsVision: true,
      },
      byModel: {
        'glm-4.7': {
          supportsDocumentBlocks: true,
          supportsToolUse: true,
        },
        'glm-5': {
          supportsStructuredOutput: false,
        },
      },
    })

    expect(summary).toEqual({
      defaultFlagsChanged: ['supportsVision'],
      byModelFlagsChanged: {
        'glm-4.7': ['supportsDocumentBlocks', 'supportsToolUse'],
        'glm-5': ['supportsStructuredOutput'],
      },
    })
  })
})
