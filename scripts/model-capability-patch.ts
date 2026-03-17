import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  applyCapabilityPatchToConfig,
  buildConnectionCapabilityPatch,
  mergeConnectionCapabilityPatch,
  summarizeConnectionCapabilityChanges,
  type CapabilityReportFile,
  type StoredConfig,
  type LlmConnection,
} from '../packages/shared/src/config/index.ts'

interface CliOptions {
  reportPath: string
  outputPath?: string
  connectionPath?: string
  configPath?: string
  connectionSlug?: string
  apply: boolean
  models?: string[]
}

function parseArgs(argv: string[]): CliOptions {
  let reportPath = ''
  let outputPath: string | undefined
  let connectionPath: string | undefined
  let configPath: string | undefined
  let connectionSlug: string | undefined
  let apply = false
  let models: string[] | undefined

  const args = [...argv]
  while (args.length > 0) {
    const current = args.shift()
    if (!current) break

    switch (current) {
      case '--report':
        reportPath = resolve(args.shift() ?? '')
        break
      case '--output':
        outputPath = resolve(args.shift() ?? '')
        break
      case '--connection':
        connectionPath = resolve(args.shift() ?? '')
        break
      case '--config':
        configPath = resolve(args.shift() ?? '')
        break
      case '--connection-slug':
        connectionSlug = args.shift() ?? ''
        break
      case '--apply':
        apply = true
        break
      case '--models':
        models = (args.shift() ?? '')
          .split(',')
          .map(value => value.trim())
          .filter(Boolean)
        break
      case '--help':
      case '-h':
        console.log([
          'Usage:',
          '  bun run scripts/model-capability-patch.ts --report /path/to/report.json',
          '',
          'Options:',
          '  --report <path>       Capability probe report JSON',
          '  --output <path>       Write result JSON to a file instead of stdout',
          '  --connection <path>   Existing connection JSON; merge patch into its capabilities',
          '  --config <path>       Existing config.json; merge patch into a connection in llmConnections',
          '  --connection-slug <s> Target connection slug when using --config',
          '  --apply               Write the merged config back to --config in place',
          '  --models <a,b,c>      Limit patch generation to selected model IDs',
        ].join('\n'))
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${current}`)
    }
  }

  if (!reportPath) {
    throw new Error('Missing --report')
  }
  if (configPath && !connectionSlug) {
    throw new Error('Missing --connection-slug for --config mode')
  }
  if (configPath && connectionPath) {
    throw new Error('Use either --connection or --config, not both')
  }
  if (apply && !configPath) {
    throw new Error('--apply requires --config')
  }
  if (apply && outputPath) {
    throw new Error('Use either --apply or --output, not both')
  }

  return {
    reportPath,
    outputPath,
    connectionPath,
    configPath,
    connectionSlug,
    apply,
    models,
  }
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function formatSummary(summary: ReturnType<typeof summarizeConnectionCapabilityChanges>): string {
  const lines: string[] = []
  if (summary.defaultFlagsChanged.length > 0) {
    lines.push(`default: ${summary.defaultFlagsChanged.join(', ')}`)
  }
  for (const [modelId, flags] of Object.entries(summary.byModelFlagsChanged)) {
    lines.push(`${modelId}: ${flags.join(', ')}`)
  }
  return lines.length > 0 ? lines.join('\n') : 'no capability changes'
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  const report = readJson<CapabilityReportFile>(options.reportPath)
  const patch = buildConnectionCapabilityPatch(report, options.models)

  let summaryText: string | undefined
  const output = (() => {
    if (options.connectionPath) {
      const connection = readJson<LlmConnection>(options.connectionPath)
      return {
        connection: {
          ...connection,
          capabilities: mergeConnectionCapabilityPatch(connection.capabilities, patch),
        },
      }
    }

    if (options.configPath && options.connectionSlug) {
      const config = readJson<StoredConfig>(options.configPath)
      const before = config.llmConnections?.find(connection => connection.slug === options.connectionSlug)
      const updatedConfig = applyCapabilityPatchToConfig(config, options.connectionSlug, patch)
      const after = updatedConfig.llmConnections?.find(connection => connection.slug === options.connectionSlug)
      summaryText = formatSummary(summarizeConnectionCapabilityChanges(before?.capabilities, after?.capabilities))
      return updatedConfig
    }

    return patch
  })()

  const text = JSON.stringify(output, null, 2)
  if (options.apply && options.configPath) {
    writeFileSync(options.configPath, text)
    console.log(`Capability patch applied to ${options.configPath}`)
    if (summaryText) {
      console.log(summaryText)
    }
    return
  }

  if (options.outputPath) {
    mkdirSync(dirname(options.outputPath), { recursive: true })
    writeFileSync(options.outputPath, text)
    console.log(`Capability patch written to ${options.outputPath}`)
    if (summaryText) {
      console.log(summaryText)
    }
    return
  }

  if (summaryText) {
    console.log(summaryText)
  }
  console.log(text)
}

main()
