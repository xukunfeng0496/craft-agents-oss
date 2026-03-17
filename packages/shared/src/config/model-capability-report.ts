import type { ModelCapabilityOverrides } from './models.ts'
import type { LlmConnection } from './llm-connections.ts'

export type CapabilityProbeStatus = 'pass' | 'fail' | 'skip'

export interface CapabilityProbeResult {
  name: string
  status: CapabilityProbeStatus
  durationMs: number
  summary: string
  details?: string
}

export interface CapabilityModelReport {
  model: string
  profile: string
  probes: CapabilityProbeResult[]
}

export interface CapabilityReportFile {
  generatedAt: string
  baseUrl: string
  authMode: string
  reports: CapabilityModelReport[]
}

export interface ConnectionCapabilityPatch {
  capabilities: NonNullable<LlmConnection['capabilities']>
}

export interface ConnectionConfigLike {
  llmConnections?: LlmConnection[]
}

export interface CapabilityChangeSummary {
  defaultFlagsChanged: string[]
  byModelFlagsChanged: Record<string, string[]>
}

function getProbeStatus(
  report: CapabilityModelReport,
  probeName: string
): CapabilityProbeStatus | undefined {
  return report.probes.find(probe => probe.name === probeName)?.status
}

export function buildModelCapabilityOverrides(
  report: CapabilityModelReport
): ModelCapabilityOverrides {
  const overrides: ModelCapabilityOverrides = {}

  const pdfStatus = getProbeStatus(report, 'pdf_document')
  if (pdfStatus) {
    overrides.supportsDocumentBlocks = pdfStatus === 'pass'
  }

  const toolUseStatus = getProbeStatus(report, 'tool_use')
  if (toolUseStatus) {
    overrides.supportsToolUse = toolUseStatus === 'pass'
  }

  const structuredStatus = getProbeStatus(report, 'structured_output')
  if (structuredStatus) {
    overrides.supportsStructuredOutput = structuredStatus === 'pass'
  }

  const toolLoopStatus = getProbeStatus(report, 'multi_turn_tool_loop')
  if (toolLoopStatus) {
    overrides.supportsMultiTurnToolLoop = toolLoopStatus === 'pass'
  }

  return overrides
}

export function buildConnectionCapabilityPatch(
  reportFile: CapabilityReportFile,
  modelIds?: string[]
): ConnectionCapabilityPatch {
  const selectedModels = modelIds && modelIds.length > 0
    ? new Set(modelIds.map(modelId => modelId.toLowerCase()))
    : null

  const byModel: Record<string, ModelCapabilityOverrides> = {}

  for (const report of reportFile.reports) {
    if (selectedModels && !selectedModels.has(report.model.toLowerCase())) {
      continue
    }

    byModel[report.model] = buildModelCapabilityOverrides(report)
  }

  return {
    capabilities: {
      byModel,
    },
  }
}

export function mergeConnectionCapabilityPatch(
  existing: LlmConnection['capabilities'] | undefined,
  patch: ConnectionCapabilityPatch
): NonNullable<LlmConnection['capabilities']> {
  return {
    default: {
      ...(existing?.default ?? {}),
      ...(patch.capabilities.default ?? {}),
    },
    byModel: {
      ...(existing?.byModel ?? {}),
      ...(patch.capabilities.byModel ?? {}),
    },
  }
}

export function applyCapabilityPatchToConnection(
  connection: LlmConnection,
  patch: ConnectionCapabilityPatch
): LlmConnection {
  return {
    ...connection,
    capabilities: mergeConnectionCapabilityPatch(connection.capabilities, patch),
  }
}

export function applyCapabilityPatchToConfig<T extends ConnectionConfigLike>(
  config: T,
  connectionSlug: string,
  patch: ConnectionCapabilityPatch
): T {
  if (!config.llmConnections?.length) {
    throw new Error('No llmConnections found in config')
  }

  let found = false
  const llmConnections = config.llmConnections.map(connection => {
    if (connection.slug !== connectionSlug) {
      return connection
    }
    found = true
    return applyCapabilityPatchToConnection(connection, patch)
  })

  if (!found) {
    throw new Error(`LLM connection not found: ${connectionSlug}`)
  }

  return {
    ...config,
    llmConnections,
  }
}

export function summarizeConnectionCapabilityChanges(
  before: LlmConnection['capabilities'] | undefined,
  after: LlmConnection['capabilities'] | undefined
): CapabilityChangeSummary {
  const defaultKeys = new Set<string>([
    ...Object.keys(before?.default ?? {}),
    ...Object.keys(after?.default ?? {}),
  ])
  const defaultFlagsChanged = [...defaultKeys].filter(key =>
    before?.default?.[key as keyof ModelCapabilityOverrides] !==
    after?.default?.[key as keyof ModelCapabilityOverrides]
  )

  const modelIds = new Set<string>([
    ...Object.keys(before?.byModel ?? {}),
    ...Object.keys(after?.byModel ?? {}),
  ])
  const byModelFlagsChanged: Record<string, string[]> = {}
  for (const modelId of modelIds) {
    const keys = new Set<string>([
      ...Object.keys(before?.byModel?.[modelId] ?? {}),
      ...Object.keys(after?.byModel?.[modelId] ?? {}),
    ])
    const changedFlags = [...keys].filter(key =>
      before?.byModel?.[modelId]?.[key as keyof ModelCapabilityOverrides] !==
      after?.byModel?.[modelId]?.[key as keyof ModelCapabilityOverrides]
    )
    if (changedFlags.length > 0) {
      byModelFlagsChanged[modelId] = changedFlags
    }
  }

  return {
    defaultFlagsChanged,
    byModelFlagsChanged,
  }
}
