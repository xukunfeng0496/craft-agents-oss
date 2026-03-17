import { describe, expect, it } from 'bun:test'

import {
  supportsDocumentBlocks,
  supportsMultiTurnToolLoop,
  supportsStructuredOutput,
  supportsToolUse,
  supportsVision,
} from '../models.ts'

describe('supportsDocumentBlocks', () => {
  it('enables inline document blocks for Claude-native models', () => {
    expect(supportsDocumentBlocks('claude-sonnet-4-5-20250929')).toBe(true)
    expect(supportsDocumentBlocks('anthropic/claude-sonnet-4')).toBe(true)
  })

  it('defaults conservatively for routed or non-Claude models', () => {
    expect(supportsDocumentBlocks('CVTE-AUTO')).toBe(false)
    expect(supportsDocumentBlocks('glm-5')).toBe(false)
  })
})

describe('capability helpers', () => {
  it('enables Claude-native multimodal and tooling helpers', () => {
    expect(supportsVision('claude-sonnet-4-5-20250929')).toBe(true)
    expect(supportsToolUse('claude-sonnet-4-5-20250929')).toBe(true)
    expect(supportsStructuredOutput('claude-sonnet-4-5-20250929')).toBe(true)
    expect(supportsMultiTurnToolLoop('claude-sonnet-4-5-20250929')).toBe(true)
  })

  it('defaults conservatively for routed or unknown models', () => {
    expect(supportsVision('CVTE-AUTO')).toBe(false)
    expect(supportsVision('glm-5')).toBe(false)
    expect(supportsToolUse('CVTE-AUTO')).toBe(false)
    expect(supportsStructuredOutput('glm-5')).toBe(false)
    expect(supportsMultiTurnToolLoop('unknown-router-model')).toBe(false)
  })
})
