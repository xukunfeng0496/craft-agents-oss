/**
 * Mermaid Validate Handler
 *
 * Validates Mermaid diagram syntax using beautiful-mermaid renderer.
 * No DOM required - works identically in Claude and Codex.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { renderMermaid } from 'beautiful-mermaid';

export interface MermaidValidateArgs {
  code: string;
}

/**
 * Handle the mermaid_validate tool call.
 *
 * Uses renderMermaid from beautiful-mermaid to validate syntax.
 * If rendering succeeds, the diagram is valid.
 * If rendering throws, returns the error message.
 */
export async function handleMermaidValidate(
  _ctx: SessionToolContext,
  args: MermaidValidateArgs
): Promise<ToolResult> {
  const { code } = args;

  try {
    // renderMermaid throws if syntax is invalid
    await renderMermaid(code);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          valid: true,
          message: 'Diagram syntax is valid',
        }, null, 2),
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          valid: false,
          error: errorMessage,
          suggestion: 'Check the syntax against ~/.workagent/docs/mermaid.md',
        }, null, 2),
      }],
      isError: true,
    };
  }
}
