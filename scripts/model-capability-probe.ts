import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

type ProbeStatus = 'pass' | 'fail' | 'skip';

interface ProbeResult {
  name: string;
  status: ProbeStatus;
  durationMs: number;
  summary: string;
  details?: string;
}

interface ModelReport {
  model: string;
  profile: string;
  probes: ProbeResult[];
}

interface CliOptions {
  models: string[];
  outputPath: string;
  baseUrl?: string;
  timeoutMs: number;
  maxTokens: number;
  dryRun: boolean;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_TOKENS = 256;

function printHelp(): void {
  console.log(`
Model capability probe for Anthropic-compatible endpoints.

Usage:
  bun run scripts/model-capability-probe.ts --models CVTE-AUTO,glm-5

Environment:
  ANTHROPIC_API_KEY      API key for x-api-key auth
  ANTHROPIC_AUTH_TOKEN   Bearer token auth (preferred if your gateway requires it)
  ANTHROPIC_BASE_URL     Anthropic-compatible endpoint base URL
  MODEL_IDS              Comma-separated model IDs (fallback if --models omitted)

Options:
  --models <ids>         Comma-separated model IDs
  --output <path>        Report path (default: ./tmp/model-capability-report-<ts>.json)
  --base-url <url>       Override ANTHROPIC_BASE_URL
  --timeout-ms <ms>      Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})
  --max-tokens <n>       Max output tokens per probe (default: ${DEFAULT_MAX_TOKENS})
  --dry-run              Print resolved configuration without calling the API
  --help                 Show this help
`);
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let modelsArg = process.env.MODEL_IDS ?? process.env.MODELS ?? '';
  let outputPath = join(process.cwd(), 'tmp', `model-capability-report-${Date.now()}.json`);
  let baseUrl = process.env.ANTHROPIC_BASE_URL?.trim();
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let maxTokens = DEFAULT_MAX_TOKENS;
  let dryRun = false;

  while (args.length > 0) {
    const current = args.shift();
    if (!current) break;

    switch (current) {
      case '--models':
        modelsArg = args.shift() ?? '';
        break;
      case '--output':
        outputPath = resolve(args.shift() ?? outputPath);
        break;
      case '--base-url':
        baseUrl = args.shift() ?? baseUrl;
        break;
      case '--timeout-ms':
        timeoutMs = Number(args.shift() ?? timeoutMs);
        break;
      case '--max-tokens':
        maxTokens = Number(args.shift() ?? maxTokens);
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  const models = modelsArg
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms: ${timeoutMs}`);
  }
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new Error(`Invalid --max-tokens: ${maxTokens}`);
  }

  return {
    models,
    outputPath,
    baseUrl,
    timeoutMs,
    maxTokens,
    dryRun,
  };
}

function createClient(options: CliOptions): Anthropic {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!authToken && !apiKey) {
    throw new Error('Missing credentials. Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY.');
  }

  return new Anthropic({
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    ...(authToken
      ? { authToken, apiKey: null }
      : { apiKey: apiKey!, authToken: null }),
    timeout: options.timeoutMs,
    maxRetries: 0,
  });
}

function createPdfBase64(lines: string[]): string {
  const escapedLines = lines.map(line =>
    line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  );
  const commands: string[] = ['BT', '/F1 18 Tf', '40 140 Td'];
  for (let i = 0; i < escapedLines.length; i++) {
    if (i > 0) commands.push('0 -24 Td');
    commands.push(`(${escapedLines[i]}) Tj`);
  }
  commands.push('ET');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    '',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  const stream = `${commands.join('\n')}\n`;
  objects[3] = `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream\nendobj\n`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8').toString('base64');
}

function extractText(content: Anthropic.Messages.Message['content']): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();
}

function findToolUse(content: Anthropic.Messages.Message['content']): Anthropic.ToolUseBlock | null {
  for (const block of content) {
    if (block.type === 'tool_use') {
      return block;
    }
  }
  return null;
}

function classifyProfile(probes: ProbeResult[]): string {
  const byName = new Map(probes.map(item => [item.name, item]));
  const pass = (name: string) => byName.get(name)?.status === 'pass';

  if (
    pass('text') &&
    pass('tool_use') &&
    pass('structured_output') &&
    pass('excel_normalized') &&
    pass('multi_turn_tool_loop') &&
    pass('pdf_document')
  ) {
    return 'full-agent-compatible';
  }
  if (
    pass('text') &&
    pass('tool_use') &&
    pass('structured_output') &&
    pass('multi_turn_tool_loop')
  ) {
    return 'tool-agent-compatible';
  }
  if (pass('text') && pass('tool_use')) {
    return 'basic-tool-compatible';
  }
  if (pass('text')) {
    return 'text-only-or-fallback';
  }
  return 'incompatible';
}

async function runProbe(
  name: string,
  execute: () => Promise<{ summary: string; details?: string }>
): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const outcome = await execute();
    return {
      name,
      status: 'pass',
      durationMs: Date.now() - startedAt,
      summary: outcome.summary,
      details: outcome.details,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      status: 'fail',
      durationMs: Date.now() - startedAt,
      summary: message.split('\n')[0] ?? message,
      details: message,
    };
  }
}

async function runTextProbe(client: Anthropic, model: string, maxTokens: number): Promise<ProbeResult> {
  return runProbe('text', async () => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: 'Reply with exactly: OK_MODEL_PROBE' }],
    });
    const text = extractText(response.content);
    if (text !== 'OK_MODEL_PROBE') {
      throw new Error(`Expected "OK_MODEL_PROBE", got "${text || '<empty>'}"`);
    }
    return { summary: text };
  });
}

async function runCsvProbe(client: Anthropic, model: string, maxTokens: number): Promise<ProbeResult> {
  return runProbe('csv_text', async () => {
    const prompt = [
      'Read the CSV and reply with the total units as a plain integer.',
      '',
      'item,units',
      'alpha,10',
      'beta,12',
      'gamma,20',
    ].join('\n');

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = extractText(response.content);
    if (text !== '42') {
      throw new Error(`Expected "42", got "${text || '<empty>'}"`);
    }
    return { summary: text };
  });
}

async function runToolUseProbe(client: Anthropic, model: string, maxTokens: number): Promise<ProbeResult> {
  return runProbe('tool_use', async () => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: 'Use the echo_probe tool exactly once with {"value":"tool-ok"} and do not answer in plain text first.',
      }],
      tools: [{
        name: 'echo_probe',
        description: 'Echoes a value for capability testing.',
        input_schema: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
        },
      }],
    });

    const toolUse = findToolUse(response.content);
    if (!toolUse) {
      throw new Error(`Expected tool_use block, got text: "${extractText(response.content) || '<empty>'}"`);
    }

    const value = typeof toolUse.input === 'object' && toolUse.input !== null
      ? (toolUse.input as Record<string, unknown>).value
      : undefined;
    if (value !== 'tool-ok') {
      throw new Error(`Expected tool input value "tool-ok", got ${JSON.stringify(toolUse.input)}`);
    }

    return {
      summary: `tool_use:${toolUse.name}`,
      details: JSON.stringify(toolUse.input),
    };
  });
}

async function runExcelNormalizedProbe(client: Anthropic, model: string, maxTokens: number): Promise<ProbeResult> {
  return runProbe('excel_normalized', async () => {
    const normalizedSpreadsheet = {
      workbook: 'sales.xlsx',
      sheets: [
        {
          name: 'Q1',
          columns: ['region', 'revenue', 'margin'],
          rows: [
            { region: 'North', revenue: 120, margin: 0.30 },
            { region: 'South', revenue: 80, margin: 0.25 },
            { region: 'West', revenue: 100, margin: 0.40 },
          ],
        },
      ],
    };

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          'This is a normalized spreadsheet extracted from Excel.',
          'Reply with exactly "300|West" where 300 is total revenue and West is the highest-margin region.',
          '',
          JSON.stringify(normalizedSpreadsheet, null, 2),
        ].join('\n'),
      }],
    });

    const text = extractText(response.content);
    if (text !== '300|West') {
      throw new Error(`Expected "300|West", got "${text || '<empty>'}"`);
    }

    return { summary: text };
  });
}

async function runStructuredOutputProbe(client: Anthropic, model: string, maxTokens: number): Promise<ProbeResult> {
  return runProbe('structured_output', async () => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: 'Return a structured probe result with status="ok" and score=7.',
      }],
      tools: [{
        name: 'structured_output',
        description: 'Return structured JSON output for capability testing.',
        input_schema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            score: { type: 'number' },
          },
          required: ['status', 'score'],
        },
      }],
      tool_choice: {
        type: 'tool',
        name: 'structured_output',
      },
    });

    const toolUse = findToolUse(response.content);
    if (!toolUse) {
      throw new Error(`Expected structured tool_use block, got text: "${extractText(response.content) || '<empty>'}"`);
    }

    const input = toolUse.input as Record<string, unknown>;
    if (input.status !== 'ok' || input.score !== 7) {
      throw new Error(`Expected {"status":"ok","score":7}, got ${JSON.stringify(toolUse.input)}`);
    }

    return {
      summary: 'structured_output:ok',
      details: JSON.stringify(toolUse.input),
    };
  });
}

async function runMultiTurnToolLoopProbe(client: Anthropic, model: string, maxTokens: number): Promise<ProbeResult> {
  return runProbe('multi_turn_tool_loop', async () => {
    const tools = [{
      name: 'echo_probe',
      description: 'Echoes a value for capability testing.',
      input_schema: {
        type: 'object' as const,
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
      },
    }];

    const firstResponse = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: 'Call echo_probe with {"value":"loop-ok"} and wait for the tool result before answering.',
      }],
      tools,
    });

    const toolUse = findToolUse(firstResponse.content);
    if (!toolUse) {
      throw new Error(`Expected initial tool_use block, got text: "${extractText(firstResponse.content) || '<empty>'}"`);
    }

    const value = typeof toolUse.input === 'object' && toolUse.input !== null
      ? (toolUse.input as Record<string, unknown>).value
      : undefined;
    if (value !== 'loop-ok') {
      throw new Error(`Expected tool input value "loop-ok", got ${JSON.stringify(toolUse.input)}`);
    }

    const secondResponse = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: 'Call echo_probe with {"value":"loop-ok"} and wait for the tool result before answering.',
        },
        {
          role: 'assistant',
          content: firstResponse.content as unknown as Anthropic.MessageParam['content'],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: 'loop-ok',
          }] as unknown as Anthropic.MessageParam['content'],
        },
      ],
      tools,
    });

    const text = extractText(secondResponse.content);
    if (text !== 'LOOP_OK') {
      throw new Error(`Expected "LOOP_OK", got "${text || '<empty>'}"`);
    }

    return {
      summary: text,
      details: `tool_use_id=${toolUse.id}`,
    };
  });
}

async function runPdfProbe(client: Anthropic, model: string, maxTokens: number, pdfBase64: string): Promise<ProbeResult> {
  return runProbe('pdf_document', async () => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          {
            type: 'text',
            text: 'The PDF title is the first visible line. Reply with exactly that title and nothing else.',
          },
        ],
      }],
    });

    const text = extractText(response.content);
    if (text !== 'PDF Capability Probe') {
      throw new Error(`Expected "PDF Capability Probe", got "${text || '<empty>'}"`);
    }

    return { summary: text };
  });
}

function printModelSummary(report: ModelReport): void {
  console.log(`\nModel: ${report.model}`);
  console.log(`Profile: ${report.profile}`);
  for (const probe of report.probes) {
    const icon = probe.status === 'pass' ? 'PASS' : probe.status === 'skip' ? 'SKIP' : 'FAIL';
    console.log(`  ${icon.padEnd(4)} ${probe.name.padEnd(18)} ${String(probe.durationMs).padStart(5)}ms  ${probe.summary}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.models.length === 0) {
    throw new Error('No models provided. Use --models or set MODEL_IDS.');
  }

  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const authMode = authToken ? 'bearer' : apiKey ? 'api-key' : 'missing';

  if (options.dryRun) {
    console.log(JSON.stringify({
      baseUrl: options.baseUrl ?? 'https://api.anthropic.com',
      authMode,
      modelCount: options.models.length,
      models: options.models,
      outputPath: options.outputPath,
      timeoutMs: options.timeoutMs,
      maxTokens: options.maxTokens,
    }, null, 2));
    return;
  }

  const client = createClient(options);
  const pdfBase64 = createPdfBase64([
    'PDF Capability Probe',
    'Resume Candidate Alice',
  ]);

  const reports: ModelReport[] = [];
  for (const model of options.models) {
    console.log(`\n=== Probing ${model} ===`);
    const probes = [
      await runTextProbe(client, model, options.maxTokens),
      await runCsvProbe(client, model, options.maxTokens),
      await runToolUseProbe(client, model, options.maxTokens),
      await runExcelNormalizedProbe(client, model, options.maxTokens),
      await runStructuredOutputProbe(client, model, options.maxTokens),
      await runMultiTurnToolLoopProbe(client, model, options.maxTokens),
      await runPdfProbe(client, model, options.maxTokens, pdfBase64),
    ];
    const report: ModelReport = {
      model,
      profile: classifyProfile(probes),
      probes,
    };
    reports.push(report);
    printModelSummary(report);
  }

  const finalReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl ?? 'https://api.anthropic.com',
    authMode,
    reports,
  };

  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, JSON.stringify(finalReport, null, 2));
  console.log(`\nReport written to ${options.outputPath}`);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Probe failed: ${message}`);
  process.exitCode = 1;
});
